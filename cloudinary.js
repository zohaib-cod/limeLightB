import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

export { cloudinary };

// Helper to upload a local file or buffer to Cloudinary
export async function uploadToCloudinary(fileInput, folder = 'limelight') {
  try {
    if (typeof fileInput === 'string') {
      // Local file path
      const result = await cloudinary.uploader.upload(fileInput, {
        folder,
        resource_type: 'auto'
      });
      return {
        url: result.secure_url,
        public_id: result.public_id,
        format: result.format,
        width: result.width,
        height: result.height
      };
    } else if (fileInput && fileInput.buffer) {
      // Multer memory buffer
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder, resource_type: 'auto' },
          (error, result) => {
            if (error) return reject(error);
            resolve({
              url: result.secure_url,
              public_id: result.public_id,
              format: result.format,
              width: result.width,
              height: result.height
            });
          }
        );
        stream.end(fileInput.buffer);
      });
    }
    throw new Error('Invalid file input for Cloudinary');
  } catch (err) {
    console.error('Cloudinary upload error:', err.message);
    throw err;
  }
}

