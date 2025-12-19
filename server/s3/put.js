// server/s3/put.js
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({ region: process.env.AWS_REGION });

const BUCKET = process.env.S3_BUCKET;

export async function putJson(key, obj) {
  const Body = Buffer.from(JSON.stringify(obj, null, 2));
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body,
      ContentType: "application/json; charset=utf-8",
      CacheControl: "no-store",
    })
  );
  return { key };
}

export async function putText(key, text, contentType = "text/plain; charset=utf-8") {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: Buffer.from(text),
      ContentType: contentType,
      CacheControl: "no-store",
    })
  );
  return { key };
}
