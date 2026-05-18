/**
 * Mobile React Frontend - Photo Upload API
 */

import api from './client';

export async function uploadPhoto(file: File): Promise<{ photoUrl: string; message: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post('/photo/upload', formData);
  return data;
}
