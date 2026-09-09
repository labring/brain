/** Executed with the runtime-owned /usr/bin/python3 -I. No workspace code is imported.
 * Directory descriptors pin traversal; O_NOFOLLOW rejects symlinks at every hop.
 * A directory flock serializes all four tools across Brain processes per Devbox,
 * including path traversal. No credentials or user paths are used as global lock keys.
 * The sandbox/v1 image already provides Python; missing support fails closed.
 * Approved bash retains its wider permissions; this is not a jail for arbitrary code.
 */
export const DEVBOX_IO_SCRIPT = String.raw`import base64, errno, fcntl, json, os, secrets, selectors, signal, stat, subprocess, sys, time

CAP = 50 * 1024
LINES = 2000
DIR = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def directory(parent, name, create=False):
    if create:
        try:
            os.mkdir(name, mode=0o700, dir_fd=parent)
        except FileExistsError:
            pass
    return os.open(name, DIR, dir_fd=parent)


def root_directory(root):
    fd = os.open("/", DIR)
    try:
        for part in root.strip("/").split("/"):
            child = directory(fd, part, True)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def lock(fd, deadline):
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return
        except BlockingIOError:
            if time.monotonic() >= deadline:
                raise ValueError("Devbox operation lock timed out.")
            time.sleep(0.02)


def parent_directory(root, relative, create):
    parts = relative.split("/")
    if any(p in ("", ".", "..") for p in parts):
        raise ValueError("Invalid workspace path.")
    fd = os.dup(root)
    try:
        for part in parts[:-1]:
            child = directory(fd, part, create)
            os.close(fd)
            fd = child
        return fd, parts[-1]
    except BaseException:
        os.close(fd)
        raise


def regular(info):
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise ValueError("File must be regular, without hard links or symlinks.")


def open_file(parent, name):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    try:
        regular(os.fstat(fd))
        return fd
    except BaseException:
        os.close(fd)
        raise


def read_page(fd, offset, limit):
    # Bounded readline also bounds a single extremely long line.
    with os.fdopen(fd, "rb") as file:
        for _ in range(offset - 1):
            while True:
                chunk = file.readline(CAP + 1)
                if not chunk:
                    return {"content": "", "truncated": False}
                if chunk.endswith(b"\n"):
                    break
        chunks = []
        remaining = CAP
        for _ in range(limit):
            chunk = file.readline(remaining + 1)
            if not chunk:
                break
            if len(chunk) > remaining:
                chunks.append(chunk[:remaining])
                return {"content": b"".join(chunks).decode("utf-8", "ignore"), "truncated": True}
            chunks.append(chunk)
            remaining -= len(chunk)
        more = bool(file.read(1))
        result = {"content": b"".join(chunks).decode("utf-8"), "truncated": more}
        if more:
            result["nextOffset"] = offset + len(chunks)
        return result


def edited(source, edits):
    bom = source.startswith("\ufeff")
    text = source[1:] if bom else source
    crlf = "\r\n" in text
    text = text.replace("\r\n", "\n")
    ranges = []
    for edit in edits:
        old = edit["oldText"].replace("\r\n", "\n")
        new = edit["newText"].replace("\r\n", "\n")
        start = text.find(old)
        if start < 0:
            raise ValueError("Edit oldText was not found exactly.")
        if text.find(old, start + 1) >= 0:
            raise ValueError("Edit oldText is not unique.")
        ranges.append((start, start + len(old), new))
    ranges.sort()
    if any(current[0] < previous[1] for previous, current in zip(ranges, ranges[1:])):
        raise ValueError("Edit ranges overlap.")
    for start, end, new in reversed(ranges):
        text = text[:start] + new + text[end:]
    if crlf:
        text = text.replace("\n", "\r\n")
    return ("\ufeff" if bom else "") + text


def replace_file(parent, name, content, mode):
    data = content.encode("utf-8")
    if len(data) > CAP:
        raise ValueError("Edited file exceeds 51200 UTF-8 bytes.")
    temp = ".brain-write-" + secrets.token_hex(16)
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
    try:
        with os.fdopen(fd, "wb") as file:
            file.write(data)
            file.flush()
            os.fchmod(file.fileno(), mode)
        # Replace the directory entry; never truncate an existing linked inode.
        os.replace(temp, name, src_dir_fd=parent, dst_dir_fd=parent)
    finally:
        try:
            os.unlink(temp, dir_fd=parent)
        except FileNotFoundError:
            pass
    return len(data)


def file_operation(root, request):
    op = request["operation"]
    parent, name = parent_directory(root, request["path"], op == "write")
    try:
        if op == "read":
            return read_page(open_file(parent, name), request.get("offset", 1), request.get("limit", LINES))
        mode = 0o600
        try:
            info = os.stat(name, dir_fd=parent, follow_symlinks=False)
            regular(info)
            mode = stat.S_IMODE(info.st_mode) & 0o777
        except FileNotFoundError:
            if op != "write":
                raise
        if op == "edit":
            with os.fdopen(open_file(parent, name), "rb") as file:
                if os.fstat(file.fileno()).st_size > CAP:
                    raise ValueError("Edit target exceeds 51200 UTF-8 bytes.")
                data = file.read(CAP + 1)
            if len(data) > CAP:
                raise ValueError("Edit target exceeds 51200 UTF-8 bytes.")
            content = edited(data.decode("utf-8"), request["edits"])
        else:
            content = request["content"]
        count = replace_file(parent, name, content, mode)
        return {"success": True, "bytesWritten": count, **({"replacements": len(request["edits"])} if op == "edit" else {})}
    finally:
        os.close(parent)


def bash_operation(root, request, deadline):
    os.fchdir(root)
    process = subprocess.Popen(["/bin/bash", "-lc", request["command"]], stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    buffers = {"stdout": b"", "stderr": b""}
    truncated = False
    timed_out = False
    selector = selectors.DefaultSelector()
    try:
        for key, stream in (("stdout", process.stdout), ("stderr", process.stderr)):
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, selectors.EVENT_READ, key)
        while selector.get_map():
            if time.monotonic() >= deadline:
                timed_out = True
                break
            for key, _ in selector.select(min(0.05, max(0, deadline - time.monotonic()))):
                data = os.read(key.fileobj.fileno(), 8192)
                if not data:
                    selector.unregister(key.fileobj)
                    continue
                combined = buffers[key.data] + data
                truncated = truncated or len(combined) > CAP
                buffers[key.data] = combined[-CAP:]
        try:
            code = process.wait(timeout=max(0.001, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            timed_out = True
            code = 124
    finally:
        # Also stop descendants which kept a pipe open after the shell exited.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        selector.close()
        process.stdout.close()
        process.stderr.close()
    result = {"exitCode": 124 if timed_out else code, "timedOut": timed_out}
    for key, data in buffers.items():
        lines = data.decode("utf-8", "ignore").splitlines(keepends=True)
        truncated = truncated or len(lines) > LINES
        result[key] = "".join(lines[-LINES:])
    result["truncated"] = truncated
    return result


def main():
    request = json.loads(base64.b64decode(sys.argv[1]))
    deadline = time.monotonic() + request.get("timeoutSeconds", 60)
    root = root_directory(request["root"])
    try:
        lock(root, deadline)
        if request["operation"] == "bash":
            return bash_operation(root, request, deadline)
        return file_operation(root, request)
    finally:
        os.close(root)


try:
    print(json.dumps(main(), ensure_ascii=True))
except ValueError as error:
    print(json.dumps({"error": str(error)}))
except (OSError, UnicodeError):
    print(json.dumps({"error": "Devbox file operation failed; check path, links, permissions and UTF-8 content."}))
`;
