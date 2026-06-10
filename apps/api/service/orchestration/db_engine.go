package orchestration

import "strings"

type DBEngineProfile struct {
	// BackupMethod is the KubeBlocks BackupPolicy backupMethods[].name value, not the actionSetName.
	BackupMethod      string
	ClusterDefinition string
	ClusterVersion    string
	ComponentName     string
	Engine            string
	ServicePort       int32
	SourceType        string
	TargetPortName    string
	DefaultDatabase   string
}

func DBEngineProfileFor(engine string) (DBEngineProfile, bool) {
	normalized := strings.ToLower(strings.TrimSpace(engine))
	switch normalized {
	case "postgresql", "postgres", "pg":
		return DBEngineProfile{
			BackupMethod:      "pg-basebackup",
			ClusterDefinition: "postgresql",
			ClusterVersion:    "postgresql-16.4.0",
			ComponentName:     "postgresql",
			DefaultDatabase:   "postgres",
			Engine:            "postgresql",
			ServicePort:       5432,
			SourceType:        "Postgres",
			TargetPortName:    "tcp-postgresql",
		}, true
	case "mysql", "apecloud-mysql":
		return DBEngineProfile{
			BackupMethod:      "xtrabackup",
			ClusterDefinition: "apecloud-mysql",
			ClusterVersion:    "ac-mysql-8.0.30",
			ComponentName:     "mysql",
			DefaultDatabase:   "mysql",
			Engine:            "mysql",
			ServicePort:       3306,
			SourceType:        "MySQL",
			TargetPortName:    "mysql",
		}, true
	case "redis":
		return DBEngineProfile{
			BackupMethod:      "datafile",
			ClusterDefinition: "redis",
			ClusterVersion:    "redis-7.2.7",
			ComponentName:     "redis",
			DefaultDatabase:   "",
			Engine:            "redis",
			ServicePort:       6379,
			SourceType:        "Redis",
			TargetPortName:    "redis",
		}, true
	case "mongodb", "mongo":
		return DBEngineProfile{
			BackupMethod:      "dump",
			ClusterDefinition: "mongodb",
			ClusterVersion:    "mongodb-6.0",
			ComponentName:     "mongodb",
			DefaultDatabase:   "admin",
			Engine:            "mongodb",
			ServicePort:       27017,
			SourceType:        "MongoDB",
			TargetPortName:    "mongodb",
		}, true
	default:
		return DBEngineProfile{}, false
	}
}
