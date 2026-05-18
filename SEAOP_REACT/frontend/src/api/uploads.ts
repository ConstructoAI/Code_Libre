/**
 * SEAOP React Frontend - Uploads API Module
 * File upload support for leads and soumissions.
 */

import api from './client';

export interface UploadResult {
  fileId: string;
  filename: string;
  contentType: string;
  size: number;
  data: string; // base64
}

export async function uploadFile(file: File): Promise<UploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  // Don't set Content-Type manually — the axios interceptor (client.ts)
  // removes the default "application/json" when it sees FormData so the
  // browser can generate "multipart/form-data; boundary=..." correctly.
  const { data } = await api.post('/uploads', formData);
  return data;
}

export async function uploadMultipleFiles(files: File[]): Promise<UploadResult[]> {
  const formData = new FormData();
  files.forEach((f) => formData.append('files', f));
  const { data } = await api.post('/uploads/multi', formData);
  return data;
}
