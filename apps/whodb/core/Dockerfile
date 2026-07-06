# Copyright 2025 Clidey, Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

FROM golang:1.26-alpine3.23 AS backend-stage
RUN apk add --no-cache \
	gcc \
	g++ \
	musl-dev \
	git \
	ca-certificates \
	curl \
	binutils \
	upx

# Download official musl-compiled DuckDB shared library.
# Native musl build — no glibc stubs or compatibility hacks needed.
# Extract DuckDB version from go.mod: duckdb-go/v2 v2.XYYYZ.0 → vX.YY.Z
COPY ./core/go.mod /tmp/go.mod
ARG TARGETARCH
RUN ENCODED=$(grep 'github.com/duckdb/duckdb-go/v2 ' /tmp/go.mod | awk '{print $2}' | sed 's/v2\.//;s/\.0$//') && \
    MAJOR=$((ENCODED / 10000)) && MINOR=$(( (ENCODED % 10000) / 100 )) && PATCH=$((ENCODED % 100)) && \
    DUCKDB_VERSION="v${MAJOR}.${MINOR}.${PATCH}" && \
    echo "DuckDB version: $DUCKDB_VERSION" && \
    if [ "$TARGETARCH" = "amd64" ]; then DUCKDB_ARCH="linux-amd64"; \
    elif [ "$TARGETARCH" = "arm64" ]; then DUCKDB_ARCH="linux-arm64"; \
    else echo "Unsupported architecture: $TARGETARCH" && exit 1; fi && \
    mkdir -p /usr/local/include && \
    curl -L -o /tmp/libduckdb-musl.zip \
        "https://github.com/duckdb/duckdb/releases/download/${DUCKDB_VERSION}/libduckdb-${DUCKDB_ARCH}-musl.zip" && \
    unzip -j /tmp/libduckdb-musl.zip libduckdb.so -d /usr/local/lib/ && \
    unzip -j /tmp/libduckdb-musl.zip duckdb.h -d /usr/local/include/ && \
    strip --strip-unneeded /usr/local/lib/libduckdb.so && \
    rm /tmp/libduckdb-musl.zip

WORKDIR /app

# Copy core module files
COPY ./core/go.mod ./core/go.sum ./
RUN go mod download
COPY ./core/ ./

# Build CE backend from the new entry point
ARG VERSION=dev
ARG TARGETARCH
ARG PLATFORM=docker
ARG ENABLE_UPX=false
RUN CGO_CFLAGS="-Os -ffunction-sections -fdata-sections -fno-asynchronous-unwind-tables -fno-unwind-tables -flto -fvisibility=hidden" \
	CGO_LDFLAGS="-Wl,--gc-sections -Wl,--as-needed -flto -L/usr/local/lib -lduckdb" \
	CGO_ENABLED=1 GOOS=linux GOARCH=${TARGETARCH} go build -tags "prod duckdb_use_lib" -trimpath \
	-ldflags="-s -w -X github.com/clidey/whodb/core/src/env.ApplicationVersion=${VERSION} -X github.com/clidey/whodb/core/src/env.ApplicationEnvironment=${PLATFORM}-${TARGETARCH}" \
	-o /core ./cmd/whodb

RUN chmod +x /core && \
    if [ "$ENABLE_UPX" = "true" ]; then \
        upx --best --lzma /core; \
    fi

RUN mkdir -p /runtime-libs && \
    chmod +x /usr/local/lib/libduckdb.so && \
    if [ "$ENABLE_UPX" = "true" ] && [ "$TARGETARCH" = "amd64" ]; then \
        upx --best --lzma /usr/local/lib/libduckdb.so; \
    fi && \
    cp /usr/local/lib/libduckdb.so /runtime-libs/

FROM alpine:3.23
RUN apk add --no-cache ca-certificates libgcc libstdc++
WORKDIR /app
COPY --from=backend-stage /core /core
COPY --from=backend-stage /runtime-libs/ /usr/local/lib/
COPY LICENSE NOTICE /licenses/whodb/

CMD ["/core"]
