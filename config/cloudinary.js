const cloudinary = require('cloudinary').v2;
// cloudinary v1 package expose .v2 qui est l'API moderne — compatible multer-storage-cloudinary v4
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Supporte CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name
// Le SDK v1 la lit automatiquement si présente dans l'environnement
if (process.env.CLOUDINARY_URL) {
  cloudinary.config(process.env.CLOUDINARY_URL);
} else {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

// Storage Cloudinary pour les photos de studios
const studioStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req) => {
    const studioId = req.params.id || 'new';
    return {
      folder:          `studiokay/studios/${studioId}`,
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      transformation:  [{ width: 1920, height: 1080, crop: 'limit', quality: 'auto:good', fetch_format: 'auto' }],
      public_id:       `photo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
  },
});

// Storage Cloudinary pour les avatars utilisateurs
const avatarStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req) => ({
    folder:          `studiokay/users/avatars`,
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation:  [{ width: 400, height: 400, crop: 'fill', gravity: 'face', quality: 'auto:good' }],
    public_id:       `avatar_${req.user?.id || 'unknown'}_${Date.now()}`,
  }),
});

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Format non supporté. Utilisez JPG, PNG ou WebP.'));
  }
};

const uploadStudioPhotos = multer({
  storage: studioStorage,
  limits:  { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter,
}).array('photos', 10);

const uploadAvatar = multer({
  storage: avatarStorage,
  limits:  { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter,
}).single('avatar');

// Génère les URLs des variantes d'une photo Cloudinary
function getPhotoVariants(publicId) {
  return {
    original: cloudinary.url(publicId, { quality: 'auto', fetch_format: 'auto' }),
    medium:   cloudinary.url(publicId, { width: 800, height: 600, crop: 'limit', quality: 'auto' }),
    thumb:    cloudinary.url(publicId, { width: 400, height: 300, crop: 'fill',  quality: 'auto' }),
  };
}

module.exports = { cloudinary, uploadStudioPhotos, uploadAvatar, getPhotoVariants };
