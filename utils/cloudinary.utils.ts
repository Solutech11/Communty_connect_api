import { v2 as cloudinary } from "cloudinary";
import { env } from "../Config/env";
import { AppError } from "./AppError";

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

export const uploadImage = async (
  buffer: Buffer,
  folder: string,
): Promise<{ url: string; publicId: string }> => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `community-connect/${folder}`,
        resource_type: "image",
        overwrite: false,
        unique_filename: true,
        transformation: [{ quality: "auto", fetch_format: "auto" }],
      },
      (error, result) => {
        if (error || !result) {
          reject(new AppError(502, "Image upload failed", "CLOUDINARY_UPLOAD_FAILED"));
          return;
        }

        resolve({
          url: result.secure_url,
          publicId: result.public_id,
        });
      },
    );

    stream.end(buffer);
  });
};

export const uploadCommunityFile = async (
  buffer: Buffer,
  mimeType: string,
): Promise<{ url: string; publicId: string }> => {
  const resourceType = mimeType.startsWith("image/") ? "image" : "raw";
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "community-connect/community-chat",
        resource_type: resourceType,
        overwrite: false,
        unique_filename: true,
        use_filename: false,
      },
      (error, result) => {
        if (error || !result) {
          reject(new AppError(502, "File upload failed", "CLOUDINARY_UPLOAD_FAILED"));
          return;
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );
    stream.end(buffer);
  });
};
