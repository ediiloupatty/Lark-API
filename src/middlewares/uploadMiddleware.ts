import multer from 'multer';

const ALLOWED_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// Memory storage — file stays in buffer (not written to disk).
// Buffer is passed directly to R2 upload service for compression + upload.
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMETYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipe file tidak didukung: ${file.mimetype}. Gunakan JPG, PNG, atau WebP.`));
    }
  },
});
