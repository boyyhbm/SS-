CREATE TABLE "UploadedImage" (
    "file" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UploadedImage_pkey" PRIMARY KEY ("file"),
    CONSTRAINT "UploadedImage_size_check" CHECK ("size" > 0 AND "size" = octet_length("content"))
);
