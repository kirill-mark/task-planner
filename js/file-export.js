let nativeExporter = null;

export function setNativeExporter(exporter) {
  nativeExporter = exporter;
}

export async function exportFile(name, type, text) {
  if (nativeExporter) return nativeExporter({ name, type, text });
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { kind: "download" };
}

// Dependency injection lets tests exercise native file lifecycle without
// touching real files, devices, user data or share destinations.
export function createNativeExporter({ filesystem, share, cacheDirectory, utf8, uniqueId = () => crypto.randomUUID() }) {
  let busy = false;
  return async ({ name, text }) => {
    if (!/^mark-\d{4}-\d{2}-\d{2}\.(json|csv)$/.test(name)) throw new Error("Invalid export filename");
    if (busy) return { kind: "busy" };
    busy = true;
    const folder = `mark-exports/${uniqueId()}`;
    try {
      const { uri } = await filesystem.writeFile({
        path: `${folder}/${name}`, data: text, directory: cacheDirectory,
        encoding: utf8, recursive: true,
      });
      await share.share({ title: "Экспорт Mark", files: [uri] });
      return { kind: "shared" };
    } catch (error) {
      if (error?.message === "Share canceled") return { kind: "cancelled" };
      throw error;
    } finally {
      try { await filesystem.rmdir({ path: folder, directory: cacheDirectory, recursive: true }); } catch { /* OS can clear remaining cache */ }
      busy = false;
    }
  };
}
