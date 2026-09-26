import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isPointVisible } from './astronomy/horizon';
import { calculateSky, describeMoonPhase } from './astronomy/sky';
import {
  MAX_YEAR,
  MIN_YEAR,
  formatObservationDate,
  localObservationToUtc,
  zonedObservationStrings,
} from './astronomy/time';
import { ControlPanel } from './components/ControlPanel';
import { DiurnalRotationBar } from './components/DiurnalRotationBar';
import { GlobeCanvas } from './components/GlobeCanvas';
import { ObservationConditionsPanel } from './components/ObservationConditionsPanel';
import { SkyCanvas } from './components/SkyCanvas';
import { useDeviceSkyView } from './hooks/useDeviceSkyView';
import { fetchLightPollution } from './services/lightPollution';
import { resolveTimezone, reverseLocation, watchCurrentCoordinates } from './services/location';
import { fetchTerrainProfile } from './services/terrain';
import { fetchHistoricalWeather } from './services/weather';
import type {
  ConditionResult,
  ConditionState,
  DisplayOptions,
  EnvironmentState,
  GpsStatus,
  ObservationConditions,
  ObservationLocation,
  SkyViewMode,
} from './types';

const initialLocation: ObservationLocation = {
  name: '東京都、日本',
  latitude: 35.6812,
  longitude: 139.7671,
  elevation: 40,
  timezone: 'Asia/Tokyo',
};

const ENVIRONMENT_FETCH_DELAY = 700;
// 自動回転は1秒あたり1時間進め、更新は最短でも90ms間隔にまとめる。
const AUTO_ROTATION_MINUTES_PER_SECOND = 60;
const AUTO_ROTATION_STEP_MS = 90;
const AUTO_ROTATION_MAX_GAP_MS = 400;

function loadingEnvironment(): EnvironmentState {
  return {
    weather: { status: 'loading', message: '過去天候を取得しています…' },
    lightPollution: { status: 'loading', message: '衛星夜間光を取得しています…' },
    terrain: { status: 'loading', message: '周辺標高を取得しています…' },
  };
}

async function settleCondition<T>(promise: Promise<ConditionResult<T>>, signal: AbortSignal): Promise<ConditionState<T>> {
  try {
    return await promise;
  } catch (error) {
    if (signal.aborted) throw error;
    return { status: 'error', message: error instanceof Error ? error.message : 'データを取得できませんでした。' };
  }
}

function getTodayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function App() {
  const [date, setDate] = useState(getTodayDate());
  const [time, setTime] = useState('21:00');
  const [location, setLocation] = useState(initialLocation);
  const [magnitudeLimit, setMagnitudeLimit] = useState(6.5);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [compassEnabled, setCompassEnabled] = useState(false);
  const [viewMode, setViewMode] = useState<SkyViewMode>('chart');
  // 入力した観測時刻からのずれ。日周回転で増減する。
  const [rotationMinutes, setRotationMinutes] = useState(0);
  const [autoRotating, setAutoRotating] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('idle');
  const [environment, setEnvironment] = useState<EnvironmentState>(loadingEnvironment);
  const skyCardRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);
  const deviceSky = useDeviceSkyView(compassEnabled);
  const [options, setOptions] = useState<DisplayOptions>({
    constellations: true,
    labels: true,
    planets: true,
    weather: false,
    lightPollution: false,
    terrain: false,
  });

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(document.fullscreenElement === skyCardRef.current);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (compassEnabled && (deviceSky.status === 'denied' || deviceSky.status === 'error' || deviceSky.status === 'unsupported')) {
      setCompassEnabled(false);
    }
  }, [compassEnabled, deviceSky.status]);

  const observation = useMemo(() => {
    try {
      const base = localObservationToUtc(date, time, location.timezone);
      const utc = new Date(base.getTime() + rotationMinutes * 60_000);
      return { utc, local: zonedObservationStrings(utc, location.timezone), error: '' };
    } catch (error) {
      return { utc: null, local: null, error: error instanceof Error ? error.message : '観測日時を変換できませんでした。' };
    }
  }, [date, time, location.timezone, rotationMinutes]);
  const observationTimestamp = observation.utc?.getTime() ?? null;

  useEffect(() => {
    if (!observation.utc) {
      const unavailable = { status: 'unavailable' as const, message: '有効な観測日時を指定してください。' };
      setEnvironment({ weather: unavailable, lightPollution: unavailable, terrain: unavailable });
      return;
    }
    const controller = new AbortController();
    const requestId = ++requestRef.current;
    const signal = controller.signal;
    // 日周回転のような連続操作の途中では取得せず、落ち着いてから1回だけ走らせる。
    const timer = setTimeout(() => {
      setEnvironment(loadingEnvironment());

      void settleCondition(fetchHistoricalWeather(observation.utc, location, signal), signal)
        .then((weather) => {
          if (!signal.aborted && requestRef.current === requestId) {
            setEnvironment((current) => ({ ...current, weather }));
          }
        }).catch(() => {
          // Aborted requests are superseded by the next observation input.
        });
      void settleCondition(fetchLightPollution(observation.utc, location, signal), signal)
        .then((lightPollution) => {
          if (!signal.aborted && requestRef.current === requestId) {
            setEnvironment((current) => ({ ...current, lightPollution }));
          }
        }).catch(() => {
          // Aborted requests are superseded by the next observation input.
        });
      void settleCondition(fetchTerrainProfile(location, signal), signal)
        .then((terrain) => {
          if (!signal.aborted && requestRef.current === requestId) {
            setEnvironment((current) => ({ ...current, terrain }));
          }
        }).catch(() => {
          // Aborted requests are superseded by the next observation input.
        });
    }, ENVIRONMENT_FETCH_DELAY);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [observationTimestamp, location.latitude, location.longitude, location.elevation]);

  const conditions = useMemo<ObservationConditions>(() => ({
    weather: options.weather ? environment.weather.data : undefined,
    lightPollution: options.lightPollution ? environment.lightPollution.data : undefined,
    terrain: options.terrain ? environment.terrain.data : undefined,
  }), [environment, options.weather, options.lightPollution, options.terrain]);

  const calculation = useMemo(() => {
    if (!observation.utc) return { sky: null, error: observation.error };
    try {
      return { sky: calculateSky(observation.utc, location, magnitudeLimit, conditions), error: '' };
    } catch (error) {
      return { sky: null, error: error instanceof Error ? error.message : '星空を計算できませんでした。' };
    }
  }, [observation, location, magnitudeLimit, conditions]);

  const stopRotation = useCallback(() => {
    setRotationMinutes(0);
    setAutoRotating(false);
  }, []);

  /** 日周回転を進める。対応年を外れる場合は進めずfalseを返す。 */
  const shiftRotation = useCallback((deltaMinutes: number) => {
    if (!observation.utc) return false;
    try {
      const shifted = new Date(observation.utc.getTime() + deltaMinutes * 60_000);
      const { year } = zonedObservationStrings(shifted, location.timezone);
      if (year < MIN_YEAR || year > MAX_YEAR) return false;
    } catch {
      return false;
    }
    setRotationMinutes((current) => current + deltaMinutes);
    return true;
  }, [observation.utc, location.timezone]);

  const shiftRotationRef = useRef(shiftRotation);
  shiftRotationRef.current = shiftRotation;

  useEffect(() => {
    if (!autoRotating) return;
    let frame = 0;
    let previous = performance.now();
    let carried = 0;
    const step = (now: number) => {
      const elapsed = now - previous;
      previous = now;
      // タブが隠れるとフレームが止まるため、空いた時間は進めずに捨てる。
      if (elapsed > AUTO_ROTATION_MAX_GAP_MS) {
        frame = requestAnimationFrame(step);
        return;
      }
      carried += elapsed;
      // 毎フレーム星空を再計算すると重いため、更新間隔をまとめる。
      // 進める分は経過時間から出すので、間引いても速度は変わらない。
      if (carried >= AUTO_ROTATION_STEP_MS) {
        const minutes = carried / 1000 * AUTO_ROTATION_MINUTES_PER_SECOND;
        carried = 0;
        if (!shiftRotationRef.current(minutes)) {
          setAutoRotating(false);
          return;
        }
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [autoRotating]);

  const deviceTracking = deviceSky.isMobile && compassEnabled;
  const activeViewMode: SkyViewMode = deviceTracking ? 'chart' : viewMode;
  const visibleStars = calculation.sky?.stars.filter((star) => isPointVisible(star, calculation.sky?.conditions.terrain)).length ?? 0;

  useEffect(() => {
    if (!deviceSky.isMobile || !compassEnabled || !deviceSky.permissionGranted) {
      setGpsStatus('idle');
      return;
    }

    let cancelled = false;
    let resolving = false;
    let lastAttemptAt = 0;
    let lastAccepted: { latitude: number; longitude: number } | null = null;
    setGpsStatus('requesting');

    const stopWatching = watchCurrentCoordinates(async (coordinates) => {
      const now = Date.now();
      if (resolving || (lastAttemptAt > 0 && now - lastAttemptAt < 30_000)) return;
      if (lastAccepted) {
        const latitudeDistance = (coordinates.latitude - lastAccepted.latitude) * 111_320;
        const longitudeDistance = (coordinates.longitude - lastAccepted.longitude)
          * 111_320 * Math.cos(coordinates.latitude * Math.PI / 180);
        if (Math.hypot(latitudeDistance, longitudeDistance) < 100) return;
      }

      resolving = true;
      lastAttemptAt = now;
      try {
        const [name, timezone] = await Promise.all([
          reverseLocation(coordinates.latitude, coordinates.longitude),
          resolveTimezone(coordinates.latitude, coordinates.longitude),
        ]);
        if (cancelled) return;
        lastAccepted = coordinates;
        setLocation({ ...coordinates, name, timezone });
        setGpsStatus('active');
      } catch {
        if (!cancelled) setGpsStatus('error');
      } finally {
        resolving = false;
      }
    }, () => {
      if (!cancelled) setGpsStatus('error');
    });

    return () => {
      cancelled = true;
      stopWatching();
    };
  }, [compassEnabled, deviceSky.isMobile, deviceSky.permissionGranted]);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await skyCardRef.current?.requestFullscreen();
    } catch {
      // Fullscreen may be blocked by the browser or embedding context.
    }
  };

  const toggleCompass = async () => {
    // コンパス追従は全天星図に固定されるため、日周回転は止める。
    setAutoRotating(false);
    if (compassEnabled) {
      setCompassEnabled(false);
      return;
    }
    setCompassEnabled(true);
    await deviceSky.prepare();
  };

  return (
    <main className="app-shell" id="top">
      <header className="app-header">
        <a className="brand" href="#top" aria-label="あの日の空 ホーム">
          <span className="brand-orbit" aria-hidden="true"><span>✦</span></span>
          <span>あの日の空</span>
        </a>
        <p>Birthday Sky Archive</p>
        <span className="header-note">ASTRONOMY × MEMORY</span>
      </header>

      <section className="workspace">
        <aside className="control-panel">
          <div className="hero-copy">
            <p className="eyebrow">YOUR SKY, THAT NIGHT</p>
            <h1>あの日、空には<br />何が見えていた？</h1>
            <p className="intro">生まれた日、生まれた場所。<br />あなたの物語が始まった夜空をひらきます。</p>
          </div>
          <ControlPanel
            date={date}
            time={time}
            location={location}
            magnitudeLimit={magnitudeLimit}
            error={calculation.error}
            onDateChange={(value) => { setDate(value); stopRotation(); }}
            onTimeChange={(value) => { setTime(value); stopRotation(); }}
            onLocationChange={setLocation}
            onMagnitudeLimitChange={setMagnitudeLimit}
          />
          <p className="data-credit">恒星 NASA/HEASARC · 天候/標高 Open-Meteo · 夜間光 NASA GIBS · 天体計算 Astronomy Engine</p>
        </aside>

        <section className="sky-stage" aria-label="星空表示領域">
          <div className="stage-heading">
            <div>
              <p className="stage-kicker">THE SKY ABOVE</p>
              <h2>{formatObservationDate(observation.local?.date ?? date)}</h2>
              <p>{observation.local?.time ?? time} · {location.name}</p>
            </div>
            <div className="view-mode-switch" role="group" aria-label="表示モード">
              <button
                type="button"
                className={activeViewMode === 'chart' ? 'active' : ''}
                aria-pressed={activeViewMode === 'chart'}
                disabled={deviceTracking}
                onClick={() => { setViewMode('chart'); setAutoRotating(false); }}
              >
                <span aria-hidden="true">◐</span>星図
              </button>
              <button
                type="button"
                className={activeViewMode === 'globe' ? 'active' : ''}
                aria-pressed={activeViewMode === 'globe'}
                disabled={deviceTracking}
                onClick={() => setViewMode('globe')}
              >
                <span aria-hidden="true">✳</span>天球儀
              </button>
            </div>
          </div>

          <div className="sky-card" ref={skyCardRef}>
            {!deviceSky.isMobile && (
              <button
                className="fullscreen-button"
                type="button"
                onClick={() => void toggleFullscreen()}
                disabled={!document.fullscreenEnabled}
                aria-label={isFullscreen ? 'フルスクリーンを終了' : '星空をフルスクリーン表示'}
              >
                <span aria-hidden="true">{isFullscreen ? '↙' : '↗'}</span>
                <strong>{isFullscreen ? '終了' : '全画面'}</strong>
              </button>
            )}
            {deviceSky.isMobile && (
              <button
                className={`compass-toggle${compassEnabled ? ' active' : ''}`}
                type="button"
                onClick={() => void toggleCompass()}
                aria-pressed={compassEnabled}
                aria-label={deviceSky.status === 'denied' || deviceSky.status === 'error'
                  ? 'コンパス追従を再試行'
                  : compassEnabled ? 'コンパス追従を停止' : 'コンパス追従を開始'}
              >
                <span aria-hidden="true">◎</span>
                <strong>{deviceSky.status === 'denied' || deviceSky.status === 'error'
                  ? 'コンパス再試行'
                  : `コンパス ${compassEnabled ? 'ON' : 'OFF'}`}</strong>
              </button>
            )}
            {calculation.sky ? (
              activeViewMode === 'globe' ? (
                <>
                  <GlobeCanvas sky={calculation.sky} options={options} location={location} />
                  <DiurnalRotationBar
                    rotationMinutes={rotationMinutes}
                    autoRotating={autoRotating}
                    onShift={shiftRotation}
                    onToggleAuto={() => setAutoRotating((current) => !current)}
                    onReset={stopRotation}
                  />
                </>
              ) : (
                <SkyCanvas
                  sky={calculation.sky}
                  options={options}
                  deviceMode={deviceTracking}
                  compassEnabled={compassEnabled}
                  deviceView={compassEnabled ? deviceSky.view : null}
                  sensorStatus={deviceSky.status}
                  gpsStatus={gpsStatus}
                  location={location}
                />
              )
            ) : (
              <div className="sky-error"><span>!</span><p>{calculation.error}</p></div>
            )}
            {calculation.sky && (
              <div className="sky-stats">
                <div><span>VISIBLE STARS</span><strong>{visibleStars.toLocaleString()}<small> stars</small></strong></div>
                <div><span>MOON</span><strong>{describeMoonPhase(calculation.sky.moonPhase)}</strong></div>
                <div><span>LIMIT</span><strong>{calculation.sky.limitingMagnitude.toFixed(1)}<small> mag</small></strong></div>
              </div>
            )}
          </div>

          <ObservationConditionsPanel
            environment={environment}
            options={options}
            onOptionsChange={setOptions}
          />
          <div className="stage-footnote">
            <span className="line" />
            <p>天候は再解析、光害は衛星夜間光、地形はDEMによる推定です。各カードで年代・解像度・代替値を確認できます。</p>
          </div>
        </section>
      </section>
    </main>
  );
}
