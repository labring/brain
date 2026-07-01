package k8s

import (
	"bytes"
	"context"
	"fmt"
	"io"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	"sealos/api/middleware"
)

// LogsOptions holds options for Logs, mimicking kubectl logs flags.
type LogsOptions struct {
	// Pod is the pod name (required).
	Pod string
	// Namespace. Default from kubeconfig when empty.
	Namespace string
	// Container is the container name. Empty means default/first container.
	Container string
	// TailLines limits output to last N lines. 0 means no limit.
	TailLines int64
	// SinceSeconds limits to logs from last N seconds. 0 means no limit.
	SinceSeconds int64
	// Timestamps includes timestamps in output.
	Timestamps bool
	// Previous fetches logs from previous container instance.
	Previous bool
}

// Logs streams pod logs. Writes to w and returns when done.
func Logs(cfg *clientcmdapi.Config, opts LogsOptions, w io.Writer) error {
	if opts.Pod == "" {
		return fmt.Errorf("pod is required")
	}

	resolvedCtx, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
		Namespace:        opts.Namespace,
		DefaultNamespace: corev1.NamespaceDefault,
	})
	if err != nil {
		return err
	}
	clientset, err := kubernetes.NewForConfig(resolvedCtx.RestConfig)
	if err != nil {
		return err
	}

	ns := resolvedCtx.Namespace

	podLogOpts := &corev1.PodLogOptions{
		Container:  opts.Container,
		Timestamps: opts.Timestamps,
		Previous:   opts.Previous,
	}
	if opts.TailLines > 0 {
		n := opts.TailLines
		podLogOpts.TailLines = &n
	}
	if opts.SinceSeconds > 0 {
		n := opts.SinceSeconds
		podLogOpts.SinceSeconds = &n
	}
	req := clientset.CoreV1().Pods(ns).GetLogs(opts.Pod, podLogOpts)

	stream, err := req.Stream(context.Background())
	if err != nil {
		return err
	}
	defer stream.Close()
	_, err = io.Copy(w, stream)
	return err
}

// LogsBytes returns pod logs as bytes (for REST response).
func LogsBytes(cfg *clientcmdapi.Config, opts LogsOptions) ([]byte, error) {
	var buf bytes.Buffer
	if err := Logs(cfg, opts, &buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
