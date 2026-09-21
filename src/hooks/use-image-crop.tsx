import { useCallback, useRef, useState } from "react";
import { ImageCropModal, type ImageCropOptions } from "@/components/ImageCropModal";

/**
 * Injeta o editor de recorte (arrastar + zoom) na frente de qualquer input
 * de upload de imagem já existente — sem precisar reescrever o fluxo de
 * upload de cada tela. Uso:
 *
 *   const { cropModal, cropImage } = useImageCrop({ targetW: 512, targetH: 512, shape: "circle" });
 *   <input type="file" onChange={async (e) => {
 *     const f = e.target.files?.[0];
 *     if (!f) return;
 *     const cropped = await cropImage(f);
 *     if (!cropped) return; // usuário cancelou
 *     // segue o upload normal com `cropped` no lugar do arquivo original
 *   }} />
 *   {cropModal}
 */
export function useImageCrop(options: ImageCropOptions) {
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const resolverRef = useRef<((file: File | null) => void) | null>(null);

  const cropImage = useCallback((file: File): Promise<File | null> => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setPendingFile(file);
    });
  }, []);

  const finish = useCallback(
    (result: File | null) => {
      setPendingFile(null);
      resolverRef.current?.(result);
      resolverRef.current = null;
    },
    [],
  );

  const cropModal = pendingFile ? (
    <ImageCropModal
      file={pendingFile}
      options={options}
      onCancel={() => finish(null)}
      onCropped={(blob) => {
        const cropped = new File([blob], pendingFile.name.replace(/\.\w+$/, ".jpg"), {
          type: "image/jpeg",
        });
        finish(cropped);
      }}
    />
  ) : null;

  return { cropModal, cropImage };
}
