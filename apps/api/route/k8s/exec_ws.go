package k8s

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"k8s.io/client-go/tools/remotecommand"

	"sealos/api/middleware"
	dbsvc "sealos/api/service/db"
	k8ssvc "sealos/api/service/k8s"
)

const (
	execMessageTypeInit   = "init"
	execMessageTypeInput  = "input"
	execMessageTypeError  = "error"
	execMessageTypeReady  = "ready"
	execMessageTypeClose  = "close"
	execMessageTypeResize = "resize"
)

type execClientMessage struct {
	Command    []string `json:"command,omitempty"`
	Container  string   `json:"container,omitempty"`
	Kubeconfig string   `json:"kubeconfig,omitempty"`
	Kind       string   `json:"kind,omitempty"`
	Name       string   `json:"name,omitempty"`
	Namespace  string   `json:"namespace,omitempty"`
	ProjectUID string   `json:"projectUid,omitempty"`
	Type       string   `json:"type"`
	Value      string   `json:"value,omitempty"`
	Cols       uint16   `json:"cols,omitempty"`
	Rows       uint16   `json:"rows,omitempty"`
}

type execServerMessage struct {
	Container string `json:"container,omitempty"`
	Message   string `json:"message,omitempty"`
	Namespace string `json:"namespace,omitempty"`
	Pod       string `json:"pod,omitempty"`
	Type      string `json:"type"`
	Value     string `json:"value,omitempty"`
}

var execUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func RegisterExecWebSocket(router interface {
	HandleFunc(pattern string, handlerFn http.HandlerFunc)
}) {
	router.HandleFunc("/api/k8s/v1alpha1/exec", execWebSocketHandler)
}

func execWebSocketHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := execUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	_ = conn.SetReadDeadline(time.Now().Add(30 * time.Second))
	var initMsg execClientMessage
	if err := conn.ReadJSON(&initMsg); err != nil {
		writeExecError(conn, "invalid terminal init message")
		return
	}
	_ = conn.SetReadDeadline(time.Time{})
	if initMsg.Type != execMessageTypeInit {
		writeExecError(conn, "first terminal message must be init")
		return
	}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	restConfig, cfg, err := middleware.RestConfigFromAuth("Bearer " + initMsg.Kubeconfig)
	if err != nil {
		writeExecError(conn, "invalid kubeconfig")
		return
	}
	gvr := middleware.PodsGVR()
	resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
		Namespace:        initMsg.Namespace,
		AllNamespaces:    false,
		DefaultNamespace: "",
		AdminCheckGVR:    &gvr,
	})
	if err != nil {
		writeExecError(conn, "failed to resolve Kubernetes context")
		return
	}

	stdinReader, stdinWriter := io.Pipe()
	outputWriter := &webSocketExecWriter{conn: conn}

	execConfig := restConfig
	var target k8ssvc.APWorkloadExecTarget
	if strings.EqualFold(initMsg.Kind, "db") {
		execConfig = resolved.RestConfig
		store, serr := dbsvc.NewKubernetesAccessHealthStore(resolved.RestConfig)
		if serr != nil {
			writeExecError(conn, "failed to initialize DB console store")
			return
		}
		ct, rerr := dbsvc.ResolveConsoleExecTarget(ctx, store, dbsvc.ConsoleExecRequest{
			Name:       initMsg.Name,
			Namespace:  resolved.Namespace,
			ProjectUID: initMsg.ProjectUID,
		})
		if rerr != nil {
			writeExecError(conn, execErrorMessage(rerr))
			return
		}
		target = k8ssvc.APWorkloadExecTarget{
			Namespace: ct.Namespace,
			Pod:       ct.Pod,
			Container: ct.Container,
			Command:   ct.Command,
		}
		log.Printf(
			"db console session opened: namespace=%s db=%s engine=%s pod=%s",
			ct.Namespace, initMsg.Name, ct.Engine, ct.Pod,
		)
	} else {
		var terr error
		target, terr = k8ssvc.ResolveAPWorkloadExecTarget(ctx, restConfig, k8ssvc.APWorkloadExecTargetOptions{
			Command:   initMsg.Command,
			Container: initMsg.Container,
			Name:      initMsg.Name,
			Namespace: resolved.Namespace,
		})
		if terr != nil {
			writeExecError(conn, execErrorMessage(terr))
			return
		}
	}

	if err := conn.WriteJSON(execServerMessage{
		Container: target.Container,
		Namespace: target.Namespace,
		Pod:       target.Pod,
		Type:      execMessageTypeReady,
	}); err != nil {
		return
	}

	resize := make(chan remotecommand.TerminalSize, 1)
	done := make(chan error, 1)
	go func() {
		defer stdinReader.Close()
		done <- k8ssvc.StreamPodExec(ctx, execConfig, target, stdinReader, outputWriter, outputWriter, resize)
	}()

	readDone := make(chan error, 1)
	go func() {
		defer stdinWriter.Close()
		defer close(resize)
		for {
			var msg execClientMessage
			if err := conn.ReadJSON(&msg); err != nil {
				readDone <- err
				return
			}
			switch msg.Type {
			case execMessageTypeInput:
				if _, err := io.WriteString(stdinWriter, msg.Value); err != nil {
					readDone <- err
					return
				}
			case execMessageTypeResize:
				select {
				case resize <- remotecommand.TerminalSize{Width: msg.Cols, Height: msg.Rows}:
				default:
				}
			case execMessageTypeClose:
				readDone <- nil
				return
			}
		}
	}()

	select {
	case err := <-done:
		if err != nil && !errors.Is(err, context.Canceled) {
			writeExecError(conn, err.Error())
		}
	case <-readDone:
		cancel()
		if err := <-done; err != nil && !errors.Is(err, context.Canceled) {
			writeExecError(conn, err.Error())
		}
	case <-ctx.Done():
		cancel()
	}
}

func execErrorMessage(err error) string {
	switch {
	case errors.Is(err, k8ssvc.ErrNoExecPodFound):
		return "No running pod was found for this workload."
	default:
		message := strings.TrimSpace(err.Error())
		if message == "" {
			return "Terminal connection failed."
		}
		return message
	}
}

func writeExecError(conn *websocket.Conn, message string) {
	_ = conn.WriteJSON(execServerMessage{
		Message: message,
		Type:    execMessageTypeError,
	})
}

type webSocketExecWriter struct {
	conn *websocket.Conn
}

func (w *webSocketExecWriter) Write(p []byte) (int, error) {
	message := execServerMessage{
		Type:  "output",
		Value: string(p),
	}
	if err := w.conn.WriteJSON(message); err != nil {
		return 0, fmt.Errorf("write terminal output: %w", err)
	}
	return len(p), nil
}
