/* 天气：Open-Meteo（无需 Key） */
export const WMO = {
  0: ["晴", "☀️"], 1: ["晴间多云", "🌤️"], 2: ["多云", "⛅"], 3: ["阴", "☁️"],
  45: ["雾", "🌫️"], 48: ["雾凇", "🌫️"],
  51: ["小毛毛雨", "🌦️"], 53: ["毛毛雨", "🌦️"], 55: ["大毛毛雨", "🌦️"],
  56: ["冻毛毛雨", "🌧️"], 57: ["冻毛毛雨", "🌧️"],
  61: ["小雨", "🌧️"], 63: ["中雨", "🌧️"], 65: ["大雨", "🌧️"],
  66: ["冻雨", "🌧️"], 67: ["冻雨", "🌧️"],
  71: ["小雪", "🌨️"], 73: ["中雪", "🌨️"], 75: ["大雪", "❄️"], 77: ["米雪", "🌨️"],
  80: ["阵雨", "🌦️"], 81: ["强阵雨", "🌧️"], 82: ["暴雨", "⛈️"],
  85: ["阵雪", "🌨️"], 86: ["强阵雪", "❄️"],
  95: ["雷阵雨", "⛈️"], 96: ["雷阵雨伴冰雹", "⛈️"], 99: ["强雷暴", "⛈️"],
};
export function weatherInfo(code) {
  return WMO[code] || ["未知", "🌡️"];
}

const cache = { at: 0, key: "", data: null };

export async function fetchWeather(lat, lon) {
  const key = lat + "," + lon;
  if (cache.data && cache.key === key && Date.now() - cache.at < 20 * 60 * 1000) {
    return { ...cache.data, cached: true };
  }
  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + encodeURIComponent(lat) +
    "&longitude=" + encodeURIComponent(lon) +
    "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=4&timezone=Asia%2FShanghai";
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("天气接口返回 " + resp.status);
  const j = await resp.json();
  const cur = j.current || {};
  const daily = (j.daily && j.daily.time || []).map((d, i) => ({
    date: d,
    code: j.daily.weather_code[i],
    max: Math.round(j.daily.temperature_2m_max[i]),
    min: Math.round(j.daily.temperature_2m_min[i]),
  }));
  const data = {
    temp: Math.round(cur.temperature_2m),
    feels: Math.round(cur.apparent_temperature),
    humidity: cur.relative_humidity_2m,
    wind: Math.round(cur.wind_speed_10m),
    code: cur.weather_code,
    daily,
    fetchedAt: Date.now(),
  };
  cache.at = Date.now(); cache.key = key; cache.data = data;
  return data;
}
