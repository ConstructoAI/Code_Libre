/**
 * WeatherBadge — Affichage du snapshot météo capturé au punch.
 *
 * Deux variantes :
 *   - "compact"  : pill inline (icône + température). À utiliser dans les
 *                  listes (historique de pointage) où l'espace est limité.
 *   - "detailed" : carte complète (icône large + température + condition +
 *                  détails ressenti / humidité / vent). À utiliser sur la
 *                  carte de pointage actif.
 *
 * Le composant retourne `null` si aucune donnée météo n'est disponible —
 * jamais de placeholder vide qui briserait la mise en page.
 */

import React from 'react';
import clsx from 'clsx';
import {
  Sun,
  Moon,
  Cloud,
  CloudSun,
  CloudMoon,
  CloudRain,
  CloudDrizzle,
  CloudSnow,
  CloudLightning,
  CloudFog,
  Wind,
  Droplets,
  ThermometerSun,
} from 'lucide-react';
import type { WeatherSnapshot } from '@/types';

type IconKind =
  | 'sun'
  | 'sun-cloud'
  | 'cloud-sun'
  | 'cloud'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'lightning';

/** Choisit l'icône Lucide selon le code WMO et le moment de la journée. */
function pickIcon(icon: string | null, isDay: boolean | null) {
  const day = isDay !== false; // null traité comme jour par défaut
  switch ((icon as IconKind) || 'cloud') {
    case 'sun':
      return day ? Sun : Moon;
    case 'sun-cloud':
    case 'cloud-sun':
      return day ? CloudSun : CloudMoon;
    case 'fog':
      return CloudFog;
    case 'drizzle':
      return CloudDrizzle;
    case 'rain':
      return CloudRain;
    case 'snow':
      return CloudSnow;
    case 'lightning':
      return CloudLightning;
    case 'cloud':
    default:
      return Cloud;
  }
}

/** Palette pastel cohérente avec Badge.tsx, déclinée par catégorie de météo. */
function pickPalette(icon: string | null, isDay: boolean | null) {
  const day = isDay !== false;
  switch ((icon as IconKind) || 'cloud') {
    case 'sun':
      return day
        ? 'text-[#9E7B1E] bg-[#F6C87A]/15 dark:text-[#F6D89A] dark:bg-[#F6C87A]/20'
        : 'text-[#5A4FB5] bg-[#B89DD4]/15 dark:text-[#C9B5E4] dark:bg-[#B89DD4]/20';
    case 'sun-cloud':
    case 'cloud-sun':
      return 'text-[#7E7E5C] bg-[#E5E0B0]/25 dark:text-[#D9D4A8] dark:bg-[#E5E0B0]/15';
    case 'cloud':
      return 'text-[#6B7B8A] bg-[#B8C4CE]/20 dark:text-[#B8C4CE] dark:bg-[#B8C4CE]/15';
    case 'fog':
      return 'text-[#7A8088] bg-[#C8CDD2]/25 dark:text-[#C8CDD2] dark:bg-[#C8CDD2]/15';
    case 'drizzle':
    case 'rain':
      return 'text-[#4A7FA8] bg-[#7BAFD4]/15 dark:text-[#9BC8E4] dark:bg-[#7BAFD4]/20';
    case 'snow':
      return 'text-[#5A8DAA] bg-[#C5E5F5]/35 dark:text-[#C5E5F5] dark:bg-[#7BAFD4]/20';
    case 'lightning':
      return 'text-[#6F4FA8] bg-[#B89DD4]/15 dark:text-[#C9B5E4] dark:bg-[#B89DD4]/20';
    default:
      return 'text-[#6B7B8A] bg-[#B8C4CE]/20 dark:text-[#B8C4CE] dark:bg-[#B8C4CE]/15';
  }
}

/** Format température : 18°C, ou "—" si null. */
function fmtTemp(t: number | null | undefined): string {
  if (t === null || t === undefined) return '—';
  return `${Math.round(t)} °C`;
}

/** Format vent : 15 km/h, ou null si manquant. */
function fmtWind(w: number | null | undefined): string | null {
  if (w === null || w === undefined) return null;
  return `${Math.round(w)} km/h`;
}

interface WeatherBadgeProps {
  weather: WeatherSnapshot | null | undefined;
  variant?: 'compact' | 'detailed';
  /** Étiquette contextuelle ("Entrée" / "Sortie") affichée dans le détail. */
  label?: string;
  className?: string;
}

const WeatherBadge: React.FC<WeatherBadgeProps> = ({
  weather,
  variant = 'compact',
  label,
  className,
}) => {
  if (!weather) return null;

  const Icon = pickIcon(weather.icon, weather.isDay);
  const palette = pickPalette(weather.icon, weather.isDay);
  const tempStr = fmtTemp(weather.temperatureC);
  const windStr = fmtWind(weather.windKmh);
  const conditionStr = weather.condition || '';

  if (variant === 'compact') {
    return (
      <span
        className={clsx(
          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md',
          'text-xs font-semibold whitespace-nowrap',
          palette,
          className,
        )}
        title={
          conditionStr
            ? `${conditionStr}${windStr ? ` · vent ${windStr}` : ''}`
            : undefined
        }
      >
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{tempStr}</span>
      </span>
    );
  }

  // ── Variant: detailed ──────────────────────────────────────────
  return (
    <div
      className={clsx(
        'rounded-xl px-4 py-3 flex items-center gap-3',
        'border border-black/5 dark:border-white/10',
        'bg-white/60 dark:bg-white/[0.03] backdrop-blur-sm',
        className,
      )}
    >
      {/* Icône principale dans une pastille colorée */}
      <div
        className={clsx(
          'flex items-center justify-center h-12 w-12 rounded-full shrink-0',
          palette,
        )}
      >
        <Icon className="h-7 w-7" aria-hidden />
      </div>

      {/* Bloc texte */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold text-gray-900 dark:text-white tabular-nums">
            {tempStr}
          </span>
          {conditionStr && (
            <span className="text-sm text-gray-600 dark:text-gray-300 truncate">
              {conditionStr}
            </span>
          )}
        </div>

        {/* Ligne secondaire : ressenti · humidité · vent */}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-500 dark:text-gray-400">
          {weather.feelsLikeC !== null && weather.feelsLikeC !== undefined && (
            <span className="inline-flex items-center gap-1">
              <ThermometerSun className="h-3 w-3" aria-hidden />
              <span>Ressenti {fmtTemp(weather.feelsLikeC)}</span>
            </span>
          )}
          {weather.humidity !== null && weather.humidity !== undefined && (
            <span className="inline-flex items-center gap-1">
              <Droplets className="h-3 w-3" aria-hidden />
              <span>{weather.humidity}%</span>
            </span>
          )}
          {windStr && (
            <span className="inline-flex items-center gap-1">
              <Wind className="h-3 w-3" aria-hidden />
              <span>{windStr}</span>
            </span>
          )}
        </div>

        {label && (
          <p className="mt-1 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Météo {label}
            {weather.locationSource === 'chantier' && (
              <span
                className="ml-1 normal-case tracking-normal text-gray-400 dark:text-gray-500"
                title="Coordonnées géocodées depuis l'adresse du chantier (GPS de l'employé non disponible)"
              >
                · approximative (chantier)
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
};

WeatherBadge.displayName = 'WeatherBadge';

export { WeatherBadge };
export type { WeatherBadgeProps };
