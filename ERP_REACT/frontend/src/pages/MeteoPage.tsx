/**
 * ERP React - Meteo Chantier Page: Weather forecast
 */
import { useEffect, useState } from 'react';
import { CloudSun, Thermometer, Droplets, Wind, Snowflake, ShieldAlert, HardHat } from 'lucide-react';
import * as secApi from '@/api/secondary';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { Badge } from '@/components/ui/Badge';

interface Forecast { date: string; tempMax: number; tempMin: number; precipitation: number; windMax: number; }

export default function MeteoPage() {
  const [stations, setStations] = useState<{ code: string; name: string; lat: number; lon: number }[]>([]);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [selectedStation, setSelectedStation] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    secApi.listWeatherStations().then((r: any) => {
      const s = r.stations || r || [];
      setStations(s);
      if (s.length > 0) setSelectedStation(s[0].code);
    }).finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedStation || stations.length === 0) return;
    const st = stations.find((s) => s.code === selectedStation);
    if (!st) return;
    setIsLoading(true);
    secApi.getWeatherForecast(st.lat, st.lon)
      .then((r: any) => setForecasts(r.forecasts || r || []))
      .finally(() => setIsLoading(false));
  }, [selectedStation, stations]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">Météo Chantier</h2>
        <div className="w-full sm:w-48">
          <Select options={stations.map((s) => ({ value: s.code, label: s.name }))} value={selectedStation}
            onChange={(e) => setSelectedStation(e.target.value)} />
        </div>
      </div>

      {isLoading ? <SkeletonPage /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
          {forecasts.map((f) => {
            const isCold = f.tempMin < 0;
            const isRain = f.precipitation > 5;
            const isWindy = f.windMax > 40;
            return (
              <Card key={f.date} padding="sm" className={isCold || isRain || isWindy ? 'border-[#F6C87A]/40 dark:border-[#F6C87A]/30' : ''}>
                <p className="text-sm font-semibold text-gray-900 dark:text-white text-center mb-2">
                  {new Date(f.date).toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' })}
                </p>
                <div className="text-center mb-2">
                  <CloudSun size={28} className="mx-auto text-[#F6C87A]" />
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1 text-gray-500"><Thermometer size={12} />Max</span>
                    <span className="font-medium text-[#E8919A]">{f.tempMax}°</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1 text-gray-500"><Thermometer size={12} />Min</span>
                    <span className={`font-medium ${isCold ? 'text-[#7BAFD4]' : 'text-gray-600'}`}>{f.tempMin}°</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1 text-gray-500"><Droplets size={12} />Pluie</span>
                    <span className={`font-medium ${isRain ? 'text-[#7BAFD4]' : 'text-gray-600'}`}>{f.precipitation}mm</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1 text-gray-500"><Wind size={12} />Vent</span>
                    <span className={`font-medium ${isWindy ? 'text-[#F0B07A]' : 'text-gray-600'}`}>{f.windMax}km/h</span>
                  </div>
                </div>
                {(isCold || isRain || isWindy) && (
                  <div className="mt-2 text-center">
                    <Badge color={isCold ? 'blue' : isWindy ? 'red' : 'yellow'} size="sm">
                      {isCold ? 'Gel' : isWindy ? 'Vent fort' : 'Pluie'}
                    </Badge>
                  </div>
                )}
              </Card>
            );
          })}
          {forecasts.length === 0 && <p className="col-span-full text-center text-gray-400 py-8">Aucune prévision disponible</p>}
        </div>
      )}

      {/* Impact chantier section */}
      {!isLoading && forecasts.length > 0 && (() => {
        const impacts: { date: string; type: 'gel' | 'pluie' | 'vent'; severity: 'warning' | 'danger'; message: string; recommendation: string }[] = [];
        for (const f of forecasts) {
          const dateLabel = new Date(f.date).toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' });
          if (f.tempMin < -10) {
            impacts.push({ date: dateLabel, type: 'gel', severity: 'danger', message: `Gel sévère (${f.tempMin} C)`, recommendation: 'Arrêter le coulage de béton. Protéger les canalisations. Prévoir chauffage des zones de travail.' });
          } else if (f.tempMin < 0) {
            impacts.push({ date: dateLabel, type: 'gel', severity: 'warning', message: `Gel prévu (${f.tempMin} C)`, recommendation: 'Protéger le béton frais avec couvertures isolantes. Utiliser additifs antigel. Vérifier protection des tuyaux.' });
          }
          if (f.precipitation > 20) {
            impacts.push({ date: dateLabel, type: 'pluie', severity: 'danger', message: `Fortes précipitations (${f.precipitation}mm)`, recommendation: 'Reporter les travaux extérieurs. Sécuriser les excavations contre inondation. Vérifier les pompes de drainage.' });
          } else if (f.precipitation > 10) {
            impacts.push({ date: dateLabel, type: 'pluie', severity: 'warning', message: `Pluie importante (${f.precipitation}mm)`, recommendation: 'Protéger les matériaux sensibles à l\'humidité. Prévoir bâches pour zones de travail. Reporter peinture extérieure.' });
          }
          if (f.windMax > 70) {
            impacts.push({ date: dateLabel, type: 'vent', severity: 'danger', message: `Vents violents (${f.windMax} km/h)`, recommendation: 'ARRÊTER les travaux en hauteur. Descendre grue. Sécuriser tous les matériaux et équipements légers.' });
          } else if (f.windMax > 50) {
            impacts.push({ date: dateLabel, type: 'vent', severity: 'warning', message: `Vents forts (${f.windMax} km/h)`, recommendation: 'Sécuriser échafaudages et bannières. Limiter travaux en hauteur. Attacher matériaux légers.' });
          }
        }

        if (impacts.length === 0) return (
          <Card className="mt-4">
            <div className="flex items-center gap-3 py-2">
              <HardHat size={24} className="text-[#7DC4A5]" />
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Impact chantier</h3>
                <p className="text-sm text-[#5aad8a]">Aucune alerte météo - conditions favorables pour les travaux</p>
              </div>
            </div>
          </Card>
        );

        return (
          <Card className="mt-4">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <ShieldAlert size={18} className="text-[#F0B07A]" /> Impact chantier - Recommandations
            </h3>
            <div className="space-y-3">
              {impacts.map((imp, i) => (
                <div key={i} className={`p-3 rounded-lg border ${imp.severity === 'danger' ? 'border-[#E8919A]/40 dark:border-[#E8919A]/30 bg-[#E8919A]/10 dark:bg-[#E8919A]/10' : 'border-[#F6C87A]/40 dark:border-[#F6C87A]/30 bg-[#F6C87A]/10 dark:bg-[#F6C87A]/10'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {imp.type === 'gel' && <Snowflake size={16} className="text-[#7BAFD4]" />}
                    {imp.type === 'pluie' && <Droplets size={16} className="text-[#7BAFD4]" />}
                    {imp.type === 'vent' && <Wind size={16} className="text-[#F0B07A]" />}
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{imp.date} - {imp.message}</span>
                    <Badge color={imp.severity === 'danger' ? 'red' : 'yellow'} size="sm">{imp.severity === 'danger' ? 'Critique' : 'Attention'}</Badge>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 ml-6">{imp.recommendation}</p>
                </div>
              ))}
            </div>
          </Card>
        );
      })()}
    </div>
  );
}
