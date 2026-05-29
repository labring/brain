package k8s

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"
)

const APWorkloadExecDefaultCommand = `clear; (bash || ash || sh)`

var ErrNoExecPodFound = errors.New("no running pod found for workload")

type APWorkloadExecTargetOptions struct {
	Command   []string
	Container string
	Name      string
	Namespace string
}

type APWorkloadExecTarget struct {
	Command   []string
	Container string
	Namespace string
	Pod       string
}

func ResolveAPWorkloadExecTarget(
	ctx context.Context,
	restConfig *rest.Config,
	opts APWorkloadExecTargetOptions,
) (APWorkloadExecTarget, error) {
	target := APWorkloadExecTarget{
		Command:   append([]string(nil), opts.Command...),
		Container: strings.TrimSpace(opts.Container),
		Namespace: strings.TrimSpace(opts.Namespace),
	}
	name := strings.TrimSpace(opts.Name)
	if target.Namespace == "" || name == "" {
		return target, fmt.Errorf("workload name and namespace are required")
	}
	if len(target.Command) == 0 {
		target.Command = []string{"/bin/sh", "-c", APWorkloadExecDefaultCommand}
	}

	clientset, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		return target, err
	}

	pods, err := clientset.CoreV1().Pods(target.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: "app=" + name,
	})
	if err != nil {
		return target, err
	}

	pod := selectExecPod(pods.Items)
	if pod == nil {
		return target, ErrNoExecPodFound
	}
	target.Pod = pod.Name
	target.Container = resolveExecContainer(*pod, target.Container, name)
	if target.Container == "" {
		return target, fmt.Errorf("pod %q has no containers", pod.Name)
	}
	return target, nil
}

func selectExecPod(pods []corev1.Pod) *corev1.Pod {
	var fallback *corev1.Pod
	for i := range pods {
		pod := &pods[i]
		if pod.DeletionTimestamp != nil {
			continue
		}
		if fallback == nil {
			fallback = pod
		}
		if pod.Status.Phase == corev1.PodRunning {
			return pod
		}
	}
	return fallback
}

func resolveExecContainer(pod corev1.Pod, requested string, workloadName string) string {
	if requested != "" {
		for _, container := range pod.Spec.Containers {
			if container.Name == requested {
				return requested
			}
		}
	}
	for _, container := range pod.Spec.Containers {
		if container.Name == workloadName {
			return workloadName
		}
	}
	if len(pod.Spec.Containers) > 0 {
		return pod.Spec.Containers[0].Name
	}
	return ""
}

func StreamPodExec(
	ctx context.Context,
	restConfig *rest.Config,
	target APWorkloadExecTarget,
	stdin io.Reader,
	stdout io.Writer,
	stderr io.Writer,
	resize <-chan remotecommand.TerminalSize,
) error {
	clientset, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		return err
	}

	req := clientset.CoreV1().RESTClient().Post().
		Resource("pods").
		Name(target.Pod).
		Namespace(target.Namespace).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Command:   target.Command,
			Container: target.Container,
			Stderr:    true,
			Stdin:     true,
			Stdout:    true,
			TTY:       true,
		}, scheme.ParameterCodec)

	executor, err := remotecommand.NewSPDYExecutor(restConfig, "POST", req.URL())
	if err != nil {
		return err
	}

	streamCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	var sizeQueue remotecommand.TerminalSizeQueue
	if resize != nil {
		sizeQueue = &channelSizeQueue{ch: resize}
	}

	done := make(chan error, 1)
	go func() {
		done <- executor.StreamWithContext(streamCtx, remotecommand.StreamOptions{
			Stdin:             stdin,
			Stdout:            stdout,
			Stderr:            stderr,
			Tty:               true,
			TerminalSizeQueue: sizeQueue,
		})
	}()

	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		cancel()
		select {
		case err := <-done:
			return err
		case <-time.After(2 * time.Second):
			return ctx.Err()
		}
	}
}

// channelSizeQueue adapts a TerminalSize channel to remotecommand.TerminalSizeQueue.
type channelSizeQueue struct {
	ch <-chan remotecommand.TerminalSize
}

func (q *channelSizeQueue) Next() *remotecommand.TerminalSize {
	size, ok := <-q.ch
	if !ok {
		return nil
	}
	return &size
}
