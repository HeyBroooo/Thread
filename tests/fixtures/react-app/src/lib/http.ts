import axios from 'axios';

export const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? '/api',
});

export async function request<T>(url: string): Promise<T> {
  const response = await apiClient.get<T>(url);
  return response.data;
}
