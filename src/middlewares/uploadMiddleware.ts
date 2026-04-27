import multer from 'multer';
import { Request, Response, NextFunction } from 'express';

const ALLOWED_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// Memory storage — file stays in buffer (not written to disk).
// Buffer is passed directly to R2 upload service for compression + upload.
const multerInstance = multer({
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

/**
 * Conditional multer middleware: only activates for multipart/form-data requests.
 * For JSON requests (Content-Type: application/json), it skips multer entirely
 * so express.json() can parse the body normally.
 *
 * Why: When multer runs on a JSON request, it doesn't parse the body,
 * resulting in req.body being undefined — breaking existing JSON endpoints.
 */
export const upload = {
  single: (fieldName: string) => {
    const multerMiddleware = multerInstance.single(fieldName);
    return (req: Request, res: Response, next: NextFunction) => {
      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('multipart/form-data')) {
        multerMiddleware(req, res, next);
      } else {
        // Skip multer — let express.json() handle the body
        next();
      }
    };
  },
};
