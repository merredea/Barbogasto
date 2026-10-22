export async function prepareImage(file: File): Promise<Blob> {
  if (file.size > 8 * 1024 * 1024) throw new Error("La imagen es demasiado grande.");
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) throw new Error("blob");
    return blob;
  } catch {
    if (file.size <= 4 * 1024 * 1024) return file;
    throw new Error("No se ha podido preparar la imagen. Prueba con un JPG más pequeño.");
  }
}
