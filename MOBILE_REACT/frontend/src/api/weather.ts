/**
 * Mobile React Frontend - Weather API
 * Weather stations and forecast data.
 */

import api from './client';
import type { WeatherStation, WeatherForecast } from '@/types';

export async function getWeatherStations(): Promise<WeatherStation[]> {
  const { data } = await api.get<{ stations: WeatherStation[] }>('/weather/stations');
  return data.stations || [];
}

export async function getWeatherForecast(lat: number, lon: number): Promise<WeatherForecast[]> {
  const { data } = await api.get<{ forecasts: WeatherForecast[] }>('/weather/forecast', {
    params: { lat, lon },
  });
  return data.forecasts || [];
}
