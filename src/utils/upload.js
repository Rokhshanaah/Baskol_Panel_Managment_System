import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { flash, verifyCsrf } from './http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(__dirname, '../../storage/app/public');
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

export function photoPublicUrl(photoPath) {
  if (!photoPath) return null;
  return `/storage/${String(photoPath).replace(/^\/+/, '')}`;
}

export function relativePhotoPath(subdir, filename) {
  return `uploads/${subdir}/${filename}`;
}

export function removePhotoFile(photoPath) {
  if (!photoPath) return;
  try {
    fs.unlinkSync(path.join(publicRoot, photoPath));
  } catch {
    /* file may already be gone */
  }
}

function ensureUploadDir(subdir) {
  const dir = path.join(publicRoot, 'uploads', subdir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function optionalPhotoUpload(subdir) {
  return createImageUpload(subdir, 'photo');
}

export function optionalLogoUpload(subdir = 'settings') {
  return createImageUpload(subdir, 'logo');
}

function createImageUpload(subdir, fieldName) {
  const dest = ensureUploadDir(subdir);
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dest),
    filename: (_req, file, cb) => {
      let ext = path.extname(file.originalname || '').toLowerCase();
      if (!ALLOWED_EXT.has(ext)) ext = '.jpg';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype?.startsWith('image/')) cb(null, true);
      else cb(new Error('invalid_image'));
    },
  }).single(fieldName);
}

function imageUploadMiddleware(subdir, fieldName, redirectPath) {
  const upload = createImageUpload(subdir, fieldName);
  return (req, res, next) => {
    upload(req, res, (err) => {
      if (err) {
        const messageKey = err.code === 'LIMIT_FILE_SIZE' || err.message === 'File too large'
          ? 'flash.photoTooLarge'
          : 'flash.photoInvalid';
        const fallback = err.code === 'LIMIT_FILE_SIZE' ? 'Photo is too large (max 2 MB).' : 'Invalid image file.';
        flash(req, 'error', req.t?.(messageKey) || fallback);
        return res.redirect(typeof redirectPath === 'function' ? redirectPath(req) : redirectPath);
      }
      if (!verifyCsrf(req)) {
        flash(req, 'error', req.t?.('flash.csrfInvalid') || 'CSRF token mismatch');
        return res.redirect(typeof redirectPath === 'function' ? redirectPath(req) : redirectPath);
      }
      return next();
    });
  };
}

export function logoUploadMiddleware(redirectPath = '/settings') {
  return imageUploadMiddleware('settings', 'logo', redirectPath);
}

export function resolveUploadedPhoto(req, subdir, existingPath = null) {
  if (!req.file) return existingPath;
  if (existingPath) removePhotoFile(existingPath);
  return relativePhotoPath(subdir, req.file.filename);
}

export function photoUploadMiddleware(subdir, redirectPath) {
  return imageUploadMiddleware(subdir, 'photo', redirectPath);
}
