const STORAGE_KEY = "s3-multipart-uploader-config";
const MB = 1024 * 1024;

const state = {
  files: [],
  uploadsInProgress: false,
};

const els = {
  bucket: document.getElementById("bucket"),
  region: document.getElementById("region"),
  prefix: document.getElementById("prefix"),
  partSize: document.getElementById("partSize"),
  partConcurrency: document.getElementById("partConcurrency"),
  fileConcurrency: document.getElementById("fileConcurrency"),
  pathStyle: document.getElementById("pathStyle"),
  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("fileInput"),
  clearFiles: document.getElementById("clearFiles"),
  startUpload: document.getElementById("startUpload"),
  fileList: document.getElementById("fileList"),
  overallBar: document.getElementById("overallBar"),
  overallText: document.getElementById("overallText"),
  log: document.getElementById("log"),
};

init();

function init() {
  loadConfig();
  applyQueryParams();
  bindEvents();
  renderFileList();
  updateButtons();
}

function applyQueryParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("bucket")) {
    els.bucket.value = params.get("bucket");
  }
  if (params.has("prefix")) {
    els.prefix.value = params.get("prefix");
  }
  if (params.has("region")) {
    els.region.value = params.get("region");
  }
  saveConfig();
}

function bindEvents() {
  const dropzone = els.dropzone;

  dropzone.addEventListener("click", () => els.fileInput.click());
  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      els.fileInput.click();
    }
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropzone.classList.add("active");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (eventName === "drop") {
        addFiles(event.dataTransfer.files);
      }
      dropzone.classList.remove("active");
    });
  });

  els.fileInput.addEventListener("change", (event) => {
    addFiles(event.target.files);
    event.target.value = "";
  });

  els.clearFiles.addEventListener("click", () => {
    if (state.uploadsInProgress) {
      return;
    }
    state.files = [];
    renderFileList();
    updateOverallProgress();
    updateButtons();
    log("Cleared file queue.");
  });

  els.startUpload.addEventListener("click", startUploads);

  [
    els.bucket,
    els.region,
    els.prefix,
    els.partSize,
    els.partConcurrency,
    els.fileConcurrency,
    els.pathStyle,
  ].forEach((input) => {
    input.addEventListener("change", saveConfig);
    input.addEventListener("input", saveConfig);
  });
}

function addFiles(fileList) {
  if (!fileList || fileList.length === 0) {
    return;
  }

  const existing = new Set(
    state.files.map((entry) => fileFingerprint(entry.file)),
  );
  let added = 0;

  for (const file of fileList) {
    const fingerprint = fileFingerprint(file);
    if (existing.has(fingerprint)) {
      continue;
    }

    existing.add(fingerprint);
    state.files.push({
      id: crypto.randomUUID(),
      file,
      key: "",
      status: "queued",
      progress: 0,
      uploadedBytes: 0,
      error: "",
    });
    added += 1;
  }

  renderFileList();
  updateOverallProgress();
  updateButtons();
  if (added > 0) {
    log(`Added ${added} file${added === 1 ? "" : "s"}.`);
  }
}

function fileFingerprint(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function renderFileList() {
  els.fileList.innerHTML = "";

  for (const entry of state.files) {
    const item = document.createElement("li");
    item.className = "file-item";
    item.dataset.fileId = entry.id;
    item.innerHTML = `
      <div class="file-head">
        <strong>${escapeHtml(entry.file.name)}</strong>
        <span class="status ${entry.status}">${formatStatus(entry)}</span>
      </div>
      <div class="file-meta">${formatBytes(entry.file.size)}</div>
      <div class="progress"><div class="bar" style="width: ${entry.progress}%;"></div></div>
    `;
    els.fileList.appendChild(item);
  }
}

function updateEntryUI(entry) {
  const item = els.fileList.querySelector(`[data-file-id="${entry.id}"]`);
  if (!item) {
    return;
  }

  const status = item.querySelector(".status");
  const bar = item.querySelector(".bar");
  status.className = `status ${entry.status}`;
  status.textContent = formatStatus(entry);
  bar.style.width = `${entry.progress}%`;
}

function formatStatus(entry) {
  if (entry.status === "error") {
    return `Error${entry.error ? `: ${entry.error}` : ""}`;
  }
  if (entry.status === "done") {
    return "Uploaded";
  }
  if (entry.status === "uploading") {
    return `${entry.progress.toFixed(1)}%`;
  }
  return "Queued";
}

function updateButtons() {
  const hasFiles = state.files.length > 0;
  els.startUpload.disabled = state.uploadsInProgress || !hasFiles;
  els.clearFiles.disabled = state.uploadsInProgress || !hasFiles;
}

function updateOverallProgress() {
  if (state.files.length === 0) {
    els.overallBar.style.width = "0%";
    els.overallText.textContent = "0%";
    return;
  }

  const totalBytes = state.files.reduce(
    (sum, entry) => sum + entry.file.size,
    0,
  );
  const uploadedBytes = state.files.reduce(
    (sum, entry) => sum + entry.uploadedBytes,
    0,
  );
  const percent = totalBytes === 0 ? 0 : (uploadedBytes / totalBytes) * 100;

  els.overallBar.style.width = `${percent}%`;
  els.overallText.textContent = `${percent.toFixed(1)}%`;
}

async function startUploads() {
  const config = readConfig();
  if (!config) {
    return;
  }

  const pendingFiles = state.files.filter((entry) => entry.status !== "done");
  if (pendingFiles.length === 0) {
    log("No pending files to upload.");
    return;
  }

  const seenKeys = new Set();
  for (const entry of pendingFiles) {
    entry.error = "";
    entry.uploadedBytes = 0;
    entry.progress = 0;
    entry.status = "queued";
    entry.key = makeUniqueKey(config.prefix, entry.file.name, seenKeys);
    updateEntryUI(entry);
  }

  state.uploadsInProgress = true;
  updateButtons();
  log(
    `Starting upload of ${pendingFiles.length} file${
      pendingFiles.length === 1 ? "" : "s"
    } to bucket ${config.bucket}.`,
  );

  await runWithConcurrency(config.fileConcurrency, pendingFiles, (entry) =>
    uploadSingleFile(entry, config),
  );

  state.uploadsInProgress = false;
  updateButtons();

  const failures = state.files.filter(
    (entry) => entry.status === "error",
  ).length;
  if (failures === 0) {
    log("All uploads completed.");
  } else {
    log(
      `Uploads completed with ${failures} failure${failures === 1 ? "" : "s"}.`,
    );
  }
}

async function uploadSingleFile(entry, config) {
  const objectUrl = buildObjectUrl(
    config.bucket,
    config.region,
    entry.key,
    config.pathStyle,
  );
  const file = entry.file;

  entry.status = "uploading";
  entry.progress = 0;
  entry.uploadedBytes = 0;
  updateEntryUI(entry);
  updateOverallProgress();

  log(`Uploading ${file.name} -> ${entry.key}`);

  try {
    await xhrRequest("PUT", objectUrl, {
      body: file,
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
      onUploadProgress: (event) => {
        if (!event.lengthComputable) {
          return;
        }
        entry.uploadedBytes = event.loaded;
        entry.progress = (event.loaded / file.size) * 100;
        updateEntryUI(entry);
        updateOverallProgress();
      },
    });

    entry.uploadedBytes = file.size;
    entry.progress = 100;
    entry.status = "done";
    updateEntryUI(entry);
    updateOverallProgress();

    log(`Uploaded ${file.name} successfully.`);
  } catch (error) {
    entry.status = "error";
    entry.error = stringifyError(error);
    updateEntryUI(entry);
    updateOverallProgress();
    log(`Upload failed for ${file.name}: ${entry.error}`);
  }
}

function makeUniqueKey(prefix, fileName, seenKeys) {
  const normalizedPrefix = prefix.trim().replace(/^\/+|\/+$/g, "");
  let key = normalizedPrefix ? `${normalizedPrefix}/${fileName}` : fileName;

  if (!seenKeys.has(key)) {
    seenKeys.add(key);
    return key;
  }

  const dotIndex = fileName.lastIndexOf(".");
  const base = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  const ext = dotIndex > 0 ? fileName.slice(dotIndex) : "";

  let counter = 1;
  while (seenKeys.has(key)) {
    const nextName = `${base}-${counter}${ext}`;
    key = normalizedPrefix ? `${normalizedPrefix}/${nextName}` : nextName;
    counter += 1;
  }

  seenKeys.add(key);
  return key;
}

function buildObjectUrl(bucket, region, key, pathStyle) {
  const bucketName = bucket.trim();
  const regionName = region.trim() || "us-east-1";
  const host =
    regionName === "us-east-1"
      ? "s3.amazonaws.com"
      : `s3.${regionName}.amazonaws.com`;
  const encodedKey = encodeS3Key(key);

  if (pathStyle) {
    return `https://${host}/${encodeURIComponent(bucketName)}/${encodedKey}`;
  }

  return `https://${bucketName}.${host}/${encodedKey}`;
}

function encodeS3Key(key) {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function createMultipartUpload(objectUrl) {
  const result = await xhrRequest("POST", `${objectUrl}?uploads`, {
    headers: {
      "Content-Type": "application/octet-stream",
    },
  });

  const uploadId = getXmlTagValue(result.body, "UploadId");
  if (!uploadId) {
    throw new Error(`Missing UploadId. Response: ${result.body.slice(0, 160)}`);
  }

  return uploadId;
}

async function uploadAllParts({
  file,
  objectUrl,
  uploadId,
  partSizeBytes,
  concurrency,
  onProgress,
}) {
  const totalParts = Math.ceil(file.size / partSizeBytes);
  const etags = new Array(totalParts);
  const partProgress = new Array(totalParts).fill(0);
  let uploadedTotal = 0;
  let nextPartNumber = 1;
  let active = 0;

  return new Promise((resolve, reject) => {
    let stopped = false;

    const launchNext = () => {
      if (stopped) {
        return;
      }

      if (nextPartNumber > totalParts && active === 0) {
        const parts = etags.map((etag, index) => ({
          partNumber: index + 1,
          etag,
        }));
        resolve(parts);
        return;
      }

      while (active < concurrency && nextPartNumber <= totalParts) {
        const partNumber = nextPartNumber;
        nextPartNumber += 1;
        active += 1;

        const partIndex = partNumber - 1;
        const start = partIndex * partSizeBytes;
        const end = Math.min(file.size, start + partSizeBytes);
        const blob = file.slice(start, end);

        uploadPart({
          objectUrl,
          uploadId,
          partNumber,
          blob,
          onProgress: (loaded) => {
            const delta = loaded - partProgress[partIndex];
            if (delta > 0) {
              partProgress[partIndex] = loaded;
              uploadedTotal += delta;
              onProgress(uploadedTotal);
            }
          },
        })
          .then((etag) => {
            etags[partIndex] = etag;
            active -= 1;
            launchNext();
          })
          .catch((error) => {
            stopped = true;
            reject(error);
          });
      }
    };

    launchNext();
  });
}

async function uploadPart({
  objectUrl,
  uploadId,
  partNumber,
  blob,
  onProgress,
}) {
  const query = `partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`;
  const result = await xhrRequest("PUT", `${objectUrl}?${query}`, {
    body: blob,
    headers: {
      "Content-Type": "application/octet-stream",
    },
    onUploadProgress: (event) => {
      if (!event.lengthComputable) {
        return;
      }
      onProgress(event.loaded);
    },
  });

  onProgress(blob.size);

  const etag = result.headers.get("ETag");
  if (!etag) {
    throw new Error(
      "Missing ETag response header for part upload. Add ETag to CORS ExposeHeaders.",
    );
  }

  return etag;
}

async function completeMultipartUpload(objectUrl, uploadId, parts) {
  const xmlParts = parts
    .map((part) => {
      const normalizedEtag = /^".*"$/.test(part.etag)
        ? part.etag
        : `"${part.etag}"`;
      return `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${escapeXml(
        normalizedEtag,
      )}</ETag></Part>`;
    })
    .join("");

  const body = `<CompleteMultipartUpload>${xmlParts}</CompleteMultipartUpload>`;

  const result = await xhrRequest(
    "POST",
    `${objectUrl}?uploadId=${encodeURIComponent(uploadId)}`,
    {
      body,
      headers: {
        "Content-Type": "application/xml",
      },
    },
  );

  if (result.body.includes("<Error>")) {
    const code = getXmlTagValue(result.body, "Code");
    const message = getXmlTagValue(result.body, "Message");
    throw new Error(
      `${code || "S3Error"}: ${message || "Complete multipart upload failed."}`,
    );
  }
}

async function abortMultipartUpload(objectUrl, uploadId) {
  await xhrRequest(
    "DELETE",
    `${objectUrl}?uploadId=${encodeURIComponent(uploadId)}`,
  );
}

function xhrRequest(method, url, options = {}) {
  const { body = null, headers = {}, onUploadProgress = null } = options;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);

    Object.entries(headers).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });

    if (onUploadProgress && xhr.upload) {
      xhr.upload.onprogress = onUploadProgress;
    }

    xhr.onload = () => {
      const status = xhr.status;
      const responseBody = xhr.responseText || "";
      if (status >= 200 && status < 300) {
        resolve({
          status,
          body: responseBody,
          headers: {
            get(name) {
              return xhr.getResponseHeader(name);
            },
          },
        });
        return;
      }

      const code = getXmlTagValue(responseBody, "Code");
      const message = getXmlTagValue(responseBody, "Message");
      const errorDetails =
        code || message
          ? `${code || "HTTPError"}: ${message || ""}`
          : responseBody;
      reject(
        new Error(`HTTP ${status} ${method} ${url} - ${errorDetails}`.trim()),
      );
    };

    xhr.onerror = () => {
      reject(new Error(`Network error while calling ${method} ${url}`));
    };

    xhr.send(body);
  });
}

function runWithConcurrency(limit, items, worker) {
  return new Promise((resolve) => {
    let index = 0;
    let active = 0;

    const next = () => {
      if (index >= items.length && active === 0) {
        resolve();
        return;
      }

      while (active < limit && index < items.length) {
        const item = items[index];
        index += 1;
        active += 1;

        Promise.resolve(worker(item))
          .catch(() => {
            // File-level errors are handled in worker; keep queue moving.
          })
          .finally(() => {
            active -= 1;
            next();
          });
      }
    };

    next();
  });
}

function readConfig() {
  const bucket = els.bucket.value.trim();
  if (!bucket) {
    log("Bucket name is required.");
    return null;
  }

  const partSizeMb = Math.max(Number(els.partSize.value) || 8, 5);
  const partConcurrency = clamp(Number(els.partConcurrency.value) || 8, 1, 32);
  const fileConcurrency = clamp(Number(els.fileConcurrency.value) || 2, 1, 8);

  return {
    bucket,
    region: (els.region.value || "us-east-1").trim(),
    prefix: (els.prefix.value || "").trim(),
    pathStyle: els.pathStyle.checked,
    partSizeMb,
    partConcurrency,
    fileConcurrency,
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function saveConfig() {
  const config = {
    bucket: els.bucket.value,
    region: els.region.value,
    prefix: els.prefix.value,
    partSize: els.partSize.value,
    partConcurrency: els.partConcurrency.value,
    fileConcurrency: els.fileConcurrency.value,
    pathStyle: els.pathStyle.checked,
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function loadConfig() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return;
  }

  try {
    const config = JSON.parse(raw);
    els.bucket.value = config.bucket || "";
    els.region.value = config.region || "us-east-1";
    els.prefix.value = config.prefix || "";
    els.partSize.value = config.partSize || "8";
    els.partConcurrency.value = config.partConcurrency || "8";
    els.fileConcurrency.value = config.fileConcurrency || "2";
    els.pathStyle.checked = Boolean(config.pathStyle);
  } catch {
    // Ignore invalid localStorage content.
  }
}

function getXmlTagValue(xml, tagName) {
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "i");
  const match = xml.match(regex);
  if (!match) {
    return "";
  }
  return decodeXml(match[1]);
}

function decodeXml(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeXml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let index = 0;

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[index]}`;
}

function stringifyError(error) {
  if (!error) {
    return "Unknown error";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function log(message) {
  const now = new Date().toLocaleTimeString();
  const line = `[${now}] ${message}`;
  const existing = els.log.textContent.trim();
  const lines = existing ? [...existing.split("\n"), line] : [line];

  const MAX_LINES = 200;
  els.log.textContent = lines.slice(-MAX_LINES).join("\n");
  els.log.scrollTop = els.log.scrollHeight;
}
