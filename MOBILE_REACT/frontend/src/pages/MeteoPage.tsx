/**
 * Mobile React Frontend - Meteo Chantier Page
 * 7-day weather forecast with construction impact alerts.
 *
 * Layout responsive:
 *   - Mobile (< sm:640px) : vertical -- carte "Aujourd hui" pleine largeur en
 *     haut + liste compacte 6 jours suivants (scroll vertical naturel).
 *     Avant : carrousel horizontal w-[140px] avec snap-x -- les jours 4-7
 *     etaient caches et le swipe horizontal n etait pas evident pour l user.
 *   - Desktop (sm:640px+) : carrousel horizontal d origine (toutes les cartes
 *     visibles cote a cote sur grand ecran).
 */

import { useEffect, useState } from 'react';
import {
  CloudSun,
  Thermometer,
  Droplets,
  Wind,
  Snowflake,
  ShieldAlert,
  HardHat,
  ChevronDown,
} from 'lucide-react';
import { Spinner } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';
import * as weatherApi from '@/api/weather';
import type { WeatherStation, WeatherForecast } from '@/types';

interface Impact {
  date: string;
  type: 'gel' | 'pluie' | 'vent';
  severity: 'warning' | 'danger';
  message: string;
  recommendation: string;
}

export default function MeteoPage() {
  const [stations, setStations] = useState<WeatherStation[]>([]);
  const [forecasts, setForecasts] = useState<WeatherForecast[]>([]);
  const [selectedStation, setSelectedStation] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Load stations on mount
  useEffect(() => {
    weatherApi
      .getWeatherStations()
      .then((s) => {
        setStations(s);
        if (s.length > 0) setSelectedStation(s[0].code);
      })
      .catch(() => setError('Impossible de charger les stations météo.'))
      .finally(() => setLoading(false));
  }, []);

  // Load forecast when station changes
  useEffect(() => {
    if (!selectedStation || stations.length === 0) return;
    const st = stations.find((s) => s.code === selectedStation);
    if (!st) return;
    setLoading(true);
    setError('');
    weatherApi
      .getWeatherForecast(st.lat, st.lon)
      .then(setForecasts)
      .catch(() => setError('Impossible de charger les prévisions.'))
      .finally(() => setLoading(false));
  }, [selectedStation, stations]);

  // Build impact alerts
  const impacts: Impact[] = [];
  for (const f of forecasts) {
    const dateLabel = new Date(f.date).toLocaleDateString('fr-CA', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    if (f.tempMin < -10) {
      impacts.push({
        date: dateLabel,
        type: 'gel',
        severity: 'danger',
        message: `Gel sévère (${f.tempMin}\u00b0C)`,
        recommendation:
          'Arrêter le coulage de béton. Protéger les canalisations. Prévoir chauffage des zones de travail.',
      });
    } else if (f.tempMin < 0) {
      impacts.push({
        date: dateLabel,
        type: 'gel',
        severity: 'warning',
        message: `Gel prévu (${f.tempMin}\u00b0C)`,
        recommendation:
          'Protéger le béton frais avec couvertures isolantes. Utiliser additifs antigel.',
      });
    }
    if (f.precipitation > 20) {
      impacts.push({
        date: dateLabel,
        type: 'pluie',
        severity: 'danger',
        message: `Fortes précipitations (${f.precipitation}mm)`,
        recommendation:
          'Reporter les travaux extérieurs. Sécuriser les excavations contre inondation.',
      });
    } else if (f.precipitation > 10) {
      impacts.push({
        date: dateLabel,
        type: 'pluie',
        severity: 'warning',
        message: `Pluie importante (${f.precipitation}mm)`,
        recommendation:
          'Protéger les matériaux sensibles. Prévoir bâches pour zones de travail.',
      });
    }
    if (f.windMax > 70) {
      impacts.push({
        date: dateLabel,
        type: 'vent',
        severity: 'danger',
        message: `Vents violents (${f.windMax} km/h)`,
        recommendation:
          'ARRÊTER les travaux en hauteur. Descendre grue. Sécuriser matériaux légers.',
      });
    } else if (f.windMax > 50) {
      impacts.push({
        date: dateLabel,
        type: 'vent',
        severity: 'warning',
        message: `Vents forts (${f.windMax} km/h)`,
        recommendation:
          'Sécuriser échafaudages. Limiter travaux en hauteur. Attacher matériaux légers.',
      });
    }
  }

  // Compare la date du forecast a la date du jour AU CHANTIER (timezone
  // America/Montreal force, pas la TZ du navigateur). Open-Meteo retourne
  // les dates en TZ du chantier (timezone=America/Montreal cote backend).
  // Sans le forcer ici, un user qui consulte depuis l'etranger (vacances,
  // bureau hors-Quebec) verrait "Aujourd hui" decale d'un jour selon sa TZ
  // locale -- bug HIGH attrape par QA Round 3.
  // Number.isFinite rejette aussi Infinity/-Infinity en plus de NaN.
  const CHANTIER_TZ = 'America/Montreal';
  const isToday = (dateStr: string) => {
    return dateStr === new Date().toLocaleDateString('en-CA', { timeZone: CHANTIER_TZ });
  };

  // Helper: formate un nombre en toFixed avec garde contre null/undefined/
  // NaN/Infinity (l'API peut retourner null sur panne capteur).
  const fmt = (v: number | null | undefined, decimals: number): string => {
    if (v == null || !Number.isFinite(v)) return '0';
    return v.toFixed(decimals);
  };

  return (
    <div className="px-4 py-5 space-y-4 pb-24">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">
          Météo Chantier
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Prévisions 7 jours et alertes chantier
        </p>
      </div>

      {/* Station selector */}
      <div className="relative">
        <select
          value={selectedStation}
          onChange={(e) => setSelectedStation(e.target.value)}
          className="w-full appearance-none bg-white/80 dark:bg-gray-800/90 backdrop-blur-sm border border-white/60 dark:border-gray-700 rounded-xl px-4 py-3 pr-10 text-gray-900 dark:text-white font-medium shadow-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-seaop-primary/50"
        >
          {stations.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
      </div>

      {error && (
        <Alert type="error" onDismiss={() => setError('')}>
          {error}
        </Alert>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <>
          {/* MOBILE LAYOUT (< sm:640px) : vertical scroll
              -- Carte Aujourd hui pleine largeur en haut
              -- Liste compacte des 6 jours suivants */}
          <div className="block sm:hidden space-y-3">
            {forecasts.length > 0 && (() => {
              // Si aucun forecast n'est "aujourd hui" (ex: API retourne J+1 a
              // J+7, ou decalage UTC apres 20h locale), fallback sur le 1er
              // forecast disponible pour eviter un ecran vide.
              const todayForecast = forecasts.find((f) => isToday(f.date)) ?? forecasts[0];
              const otherForecasts = forecasts.filter(
                (f) => f.date !== todayForecast?.date,
              );
              const t = todayForecast;
              if (!t) return null;
              const tIsToday = isToday(t.date);
              const tIsCold = t.tempMin < 0;
              const tIsRain = t.precipitation > 5;
              const tIsWindy = t.windMax > 40;
              const tHasAlert = tIsCold || tIsRain || tIsWindy;

              return (
                <>
                  {/* Carte Aujourd hui -- pleine largeur, donnees agrandies */}
                  <div
                    className={`bg-white/80 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl shadow-sm border p-4 ${
                      tHasAlert
                        ? 'border-seaop-primary dark:border-seaop-primary-400 ring-2 ring-seaop-primary/20'
                        : 'border-seaop-primary/60 dark:border-seaop-primary-400/60 ring-1 ring-seaop-primary/10'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-base font-bold text-seaop-primary dark:text-seaop-primary-400 capitalize">
                          {tIsToday
                            ? "Aujourd'hui"
                            : new Date(t.date).toLocaleDateString('fr-CA', {
                                weekday: 'long',
                                day: 'numeric',
                                month: 'long',
                              })}
                        </p>
                        {/* Sous-titre date detaillee uniquement quand le label
                            principal vaut "Aujourd hui" (sinon duplication). */}
                        {tIsToday && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                            {new Date(t.date).toLocaleDateString('fr-CA', {
                              weekday: 'long',
                              day: 'numeric',
                              month: 'long',
                            })}
                          </p>
                        )}
                      </div>
                      <CloudSun size={48} className="text-yellow-500" />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-900/40 rounded-lg px-3 py-2">
                        <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                          <Thermometer size={14} />
                          Max
                        </span>
                        <span className="text-sm font-bold text-red-500 whitespace-nowrap">
                          {fmt(t.tempMax, 1)}&deg;
                        </span>
                      </div>
                      <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-900/40 rounded-lg px-3 py-2">
                        <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                          <Thermometer size={14} />
                          Min
                        </span>
                        <span className={`text-sm font-bold whitespace-nowrap ${tIsCold ? 'text-blue-500' : 'text-gray-700 dark:text-gray-200'}`}>
                          {fmt(t.tempMin, 1)}&deg;
                        </span>
                      </div>
                      <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-900/40 rounded-lg px-3 py-2">
                        <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                          <Droplets size={14} />
                          Pluie
                        </span>
                        <span className={`text-sm font-bold whitespace-nowrap ${tIsRain ? 'text-blue-500' : 'text-gray-700 dark:text-gray-200'}`}>
                          {fmt(t.precipitation, 1)}mm
                        </span>
                      </div>
                      <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-900/40 rounded-lg px-3 py-2">
                        <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                          <Wind size={14} />
                          Vent
                        </span>
                        <span className={`text-sm font-bold whitespace-nowrap ${tIsWindy ? 'text-orange-500' : 'text-gray-700 dark:text-gray-200'}`}>
                          {fmt(t.windMax, 1)}km/h
                        </span>
                      </div>
                    </div>

                    {tHasAlert && (
                      <div className="mt-3 flex justify-center">
                        <span
                          className={`inline-block text-xs font-bold px-3 py-1 rounded-full ${
                            tIsCold
                              ? 'bg-blue-200 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
                              : tIsWindy
                                ? 'bg-orange-200 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200'
                                : 'bg-amber-200 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'
                          }`}
                        >
                          {tIsCold ? 'Alerte gel' : tIsWindy ? 'Alerte vents forts' : 'Alerte pluie'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Liste compacte des 6 jours suivants -- 1 ligne par jour */}
                  {otherForecasts.length > 0 && (
                    <div className="bg-white/80 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl shadow-sm border border-white/60 dark:border-gray-700 overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-700/50">
                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                          Prochains jours
                        </p>
                      </div>
                      <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                        {otherForecasts.map((f) => {
                          const isCold = f.tempMin < 0;
                          const isRain = f.precipitation > 5;
                          const isWindy = f.windMax > 40;
                          const hasAlert = isCold || isRain || isWindy;
                          const dateLabel = new Date(f.date).toLocaleDateString('fr-CA', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                          });

                          return (
                            <div
                              key={f.date}
                              className={`flex items-center gap-2 px-3 py-2.5 ${
                                hasAlert ? 'bg-yellow-50/60 dark:bg-yellow-900/20' : ''
                              }`}
                            >
                              {/* Icone meteo + date */}
                              <CloudSun size={24} className="shrink-0 text-yellow-500" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-gray-900 dark:text-white capitalize truncate">
                                  {dateLabel}
                                </p>
                                {hasAlert && (
                                  <p
                                    className={`text-[10px] font-bold ${
                                      isCold
                                        ? 'text-blue-600 dark:text-blue-400'
                                        : isWindy
                                          ? 'text-orange-600 dark:text-orange-400'
                                          : 'text-yellow-700 dark:text-yellow-400'
                                    }`}
                                  >
                                    {isCold ? 'Gel' : isWindy ? 'Vent fort' : 'Pluie'}
                                  </p>
                                )}
                              </div>

                              {/* Temperatures + pluie + vent en colonne droite.
                                  whitespace-nowrap + min-w generaux pour eviter
                                  wrap sur petits ecrans (320px iPhone SE). */}
                              <div className="flex items-center gap-2.5 text-xs shrink-0">
                                <div className="flex flex-col items-end">
                                  <span className="font-bold text-red-500 whitespace-nowrap">
                                    {fmt(f.tempMax, 0)}&deg;
                                  </span>
                                  <span className={`font-medium whitespace-nowrap ${isCold ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500'}`}>
                                    {fmt(f.tempMin, 0)}&deg;
                                  </span>
                                </div>
                                <div className="flex flex-col items-end gap-0.5 min-w-[58px]">
                                  <span className={`flex items-center gap-0.5 whitespace-nowrap ${isRain ? 'text-blue-500 font-semibold' : 'text-gray-400 dark:text-gray-500'}`}>
                                    <Droplets size={10} />
                                    {fmt(f.precipitation, 0)}mm
                                  </span>
                                  <span className={`flex items-center gap-0.5 whitespace-nowrap ${isWindy ? 'text-orange-500 font-semibold' : 'text-gray-400 dark:text-gray-500'}`}>
                                    <Wind size={10} />
                                    {fmt(f.windMax, 0)}km/h
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          {/* DESKTOP LAYOUT (sm:640px+) : carrousel horizontal d origine */}
          <div className="hidden sm:flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x snap-mandatory scrollbar-hide">
            {forecasts.map((f) => {
              const isCold = f.tempMin < 0;
              const isRain = f.precipitation > 5;
              const isWindy = f.windMax > 40;
              const today = isToday(f.date);
              const hasAlert = isCold || isRain || isWindy;

              return (
                <div
                  key={f.date}
                  className={`snap-center shrink-0 w-[140px] bg-white/80 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl shadow-sm border p-3 ${
                    today
                      ? 'border-seaop-primary dark:border-seaop-primary-400 ring-2 ring-seaop-primary/20'
                      : hasAlert
                        ? 'border-yellow-300 dark:border-yellow-700'
                        : 'border-white/60 dark:border-gray-700'
                  }`}
                >
                  {/* Date */}
                  <p
                    className={`text-xs font-bold text-center mb-2 ${
                      today
                        ? 'text-seaop-primary dark:text-seaop-primary-400'
                        : 'text-gray-900 dark:text-white'
                    }`}
                  >
                    {today
                      ? "Aujourd'hui"
                      : new Date(f.date).toLocaleDateString('fr-CA', {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                        })}
                  </p>

                  {/* Weather icon */}
                  <div className="text-center mb-2">
                    <CloudSun
                      size={32}
                      className="mx-auto text-yellow-500"
                    />
                  </div>

                  {/* Temps */}
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                        <Thermometer size={12} />
                        Max
                      </span>
                      <span className="font-semibold text-red-500">
                        {(f.tempMax ?? 0).toFixed(1)}&deg;
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                        <Thermometer size={12} />
                        Min
                      </span>
                      <span
                        className={`font-semibold ${isCold ? 'text-blue-500' : 'text-gray-600 dark:text-gray-300'}`}
                      >
                        {(f.tempMin ?? 0).toFixed(1)}&deg;
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                        <Droplets size={12} />
                        Pluie
                      </span>
                      <span
                        className={`font-semibold ${isRain ? 'text-blue-500' : 'text-gray-600 dark:text-gray-300'}`}
                      >
                        {(f.precipitation ?? 0).toFixed(1)}mm
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                        <Wind size={12} />
                        Vent
                      </span>
                      <span
                        className={`font-semibold ${isWindy ? 'text-orange-500' : 'text-gray-600 dark:text-gray-300'}`}
                      >
                        {(f.windMax ?? 0).toFixed(1)}km/h
                      </span>
                    </div>
                  </div>

                  {/* Alert badge */}
                  {hasAlert && (
                    <div className="mt-2 text-center">
                      <span
                        className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          isCold
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                            : isWindy
                              ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
                              : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
                        }`}
                      >
                        {isCold ? 'Gel' : isWindy ? 'Vent fort' : 'Pluie'}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {forecasts.length === 0 && !error && (
            <p className="text-center text-gray-400 dark:text-gray-500 py-8">
              Aucune prévision disponible
            </p>
          )}

          {/* Impact chantier */}
          {forecasts.length > 0 && (
            <div className="bg-white/80 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl shadow-sm border border-white/60 dark:border-gray-700 p-4">
              {impacts.length === 0 ? (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <HardHat className="w-5 h-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                      Impact chantier
                    </h3>
                    <p className="text-xs text-green-600 dark:text-green-400">
                      Aucune alerte - conditions favorables
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <ShieldAlert size={16} className="text-amber-500" />
                    Alertes chantier
                  </h3>
                  <div className="space-y-2">
                    {impacts.map((imp, i) => (
                      <div
                        key={i}
                        className={`p-3 rounded-lg border ${
                          imp.severity === 'danger'
                            ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20'
                            : 'border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {imp.type === 'gel' && (
                            <Snowflake size={14} className="text-blue-500" />
                          )}
                          {imp.type === 'pluie' && (
                            <Droplets size={14} className="text-blue-500" />
                          )}
                          {imp.type === 'vent' && (
                            <Wind size={14} className="text-orange-500" />
                          )}
                          <span className="text-xs font-semibold text-gray-900 dark:text-white">
                            {imp.date}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                              imp.severity === 'danger'
                                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                                : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
                            }`}
                          >
                            {imp.severity === 'danger' ? 'Critique' : 'Attention'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-700 dark:text-gray-300 font-medium">
                          {imp.message}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {imp.recommendation}
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
