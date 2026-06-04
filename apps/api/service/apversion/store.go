package apversion

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const defaultRetention = 10

var (
	ErrDatabaseNotConfigured = errors.New("DATABASE_URL is not configured")
	ErrVersionNotFound       = errors.New("AP image version not found")
)

type Version struct {
	Namespace       string                 `json:"namespace"`
	APName          string                 `json:"apName"`
	VersionHash     string                 `json:"versionHash"`
	Image           string                 `json:"image"`
	ImagePullPolicy string                 `json:"imagePullPolicy,omitempty"`
	Source          string                 `json:"source"`
	SpecSnapshot    map[string]interface{} `json:"specSnapshot,omitempty"`
	CreatedAt       time.Time              `json:"createdAt"`
	Active          bool                   `json:"active"`
}

type RecordInput struct {
	Namespace       string
	APName          string
	Image           string
	ImagePullPolicy string
	Source          string
	SpecSnapshot    map[string]interface{}
}

type Store struct {
	pool *pgxpool.Pool
}

var (
	defaultStore *Store
	defaultOnce  sync.Once
	defaultErr   error
)

func DefaultStore(ctx context.Context) (*Store, error) {
	defaultOnce.Do(func() {
		dsn := strings.TrimSpace(os.Getenv("DATABASE_URL"))
		if dsn == "" {
			defaultErr = ErrDatabaseNotConfigured
			return
		}
		pool, err := pgxpool.New(ctx, dsn)
		if err != nil {
			defaultErr = err
			return
		}
		store := &Store{pool: pool}
		if err := store.EnsureSchema(ctx); err != nil {
			pool.Close()
			defaultErr = err
			return
		}
		defaultStore = store
	})
	return defaultStore, defaultErr
}

func VersionSchemaStatements() []string {
	return []string{
		`create schema if not exists sealai_project`,
		`create table if not exists sealai_project.ap_image_versions (
			namespace text not null,
			ap_name text not null,
			version_hash text not null,
			image text not null,
			image_pull_policy text,
			source text not null default 'update',
			spec_snapshot jsonb,
			created_at timestamptz not null default now(),
			constraint ap_image_versions_pk primary key (namespace, ap_name, version_hash)
		)`,
		`create index if not exists ap_image_versions_lookup_idx
			on sealai_project.ap_image_versions (namespace, ap_name, created_at)`,
	}
}

func (s *Store) EnsureSchema(ctx context.Context) error {
	if s == nil || s.pool == nil {
		return ErrDatabaseNotConfigured
	}
	for _, stmt := range VersionSchemaStatements() {
		if _, err := s.pool.Exec(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}

func VersionHash(namespace, apName, image, imagePullPolicy string) string {
	payload := strings.Join([]string{
		strings.TrimSpace(namespace),
		strings.TrimSpace(apName),
		strings.TrimSpace(image),
		strings.TrimSpace(imagePullPolicy),
	}, "\x00")
	sum := sha256.Sum256([]byte(payload))
	return hex.EncodeToString(sum[:])[:16]
}

func (s *Store) Record(ctx context.Context, input RecordInput) (*Version, error) {
	if s == nil || s.pool == nil {
		return nil, ErrDatabaseNotConfigured
	}
	ns := strings.TrimSpace(input.Namespace)
	name := strings.TrimSpace(input.APName)
	image := strings.TrimSpace(input.Image)
	if ns == "" || name == "" || image == "" {
		return nil, fmt.Errorf("namespace, ap name, and image are required")
	}
	policy := strings.TrimSpace(input.ImagePullPolicy)
	source := strings.TrimSpace(input.Source)
	if source == "" {
		source = "update"
	}
	hash := VersionHash(ns, name, image, policy)
	specJSON, err := json.Marshal(input.SpecSnapshot)
	if err != nil {
		return nil, err
	}
	if len(input.SpecSnapshot) == 0 {
		specJSON = []byte("null")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	row := tx.QueryRow(ctx, `
		insert into sealai_project.ap_image_versions
			(namespace, ap_name, version_hash, image, image_pull_policy, source, spec_snapshot)
		values ($1, $2, $3, $4, nullif($5, ''), $6, $7)
		on conflict (namespace, ap_name, version_hash)
		do update set source = sealai_project.ap_image_versions.source
		returning namespace, ap_name, version_hash, image, coalesce(image_pull_policy, ''), source, spec_snapshot, created_at
	`, ns, name, hash, image, policy, source, specJSON)
	version, err := scanVersion(row)
	if err != nil {
		return nil, err
	}
	if err := prune(ctx, tx, ns, name, defaultRetention); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return version, nil
}

func (s *Store) List(ctx context.Context, namespace, apName, activeHash string) ([]Version, error) {
	if s == nil || s.pool == nil {
		return nil, ErrDatabaseNotConfigured
	}
	rows, err := s.pool.Query(ctx, `
		select namespace, ap_name, version_hash, image, coalesce(image_pull_policy, ''), source, spec_snapshot, created_at
		from sealai_project.ap_image_versions
		where namespace = $1 and ap_name = $2
		order by created_at desc, version_hash desc
	`, strings.TrimSpace(namespace), strings.TrimSpace(apName))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Version{}
	for rows.Next() {
		version, err := scanVersion(rows)
		if err != nil {
			return nil, err
		}
		version.Active = activeHash != "" && version.VersionHash == activeHash
		out = append(out, *version)
	}
	return out, rows.Err()
}

func (s *Store) Get(ctx context.Context, namespace, apName, versionHash string) (*Version, error) {
	if s == nil || s.pool == nil {
		return nil, ErrDatabaseNotConfigured
	}
	row := s.pool.QueryRow(ctx, `
		select namespace, ap_name, version_hash, image, coalesce(image_pull_policy, ''), source, spec_snapshot, created_at
		from sealai_project.ap_image_versions
		where namespace = $1 and ap_name = $2 and version_hash = $3
	`, strings.TrimSpace(namespace), strings.TrimSpace(apName), strings.TrimSpace(versionHash))
	version, err := scanVersion(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrVersionNotFound
	}
	return version, err
}

func prune(ctx context.Context, tx pgx.Tx, namespace, apName string, keep int) error {
	_, err := tx.Exec(ctx, `
		delete from sealai_project.ap_image_versions
		where namespace = $1
		  and ap_name = $2
		  and version_hash not in (
		    select version_hash
		    from sealai_project.ap_image_versions
		    where namespace = $1 and ap_name = $2
		    order by created_at desc, version_hash desc
		    limit $3
		  )
	`, namespace, apName, keep)
	return err
}

type scanner interface {
	Scan(dest ...interface{}) error
}

func scanVersion(row scanner) (*Version, error) {
	var v Version
	var specBytes []byte
	if err := row.Scan(
		&v.Namespace,
		&v.APName,
		&v.VersionHash,
		&v.Image,
		&v.ImagePullPolicy,
		&v.Source,
		&specBytes,
		&v.CreatedAt,
	); err != nil {
		return nil, err
	}
	if len(specBytes) > 0 && string(specBytes) != "null" {
		var spec map[string]interface{}
		if err := json.Unmarshal(specBytes, &spec); err == nil {
			v.SpecSnapshot = spec
		}
	}
	return &v, nil
}
