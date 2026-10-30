export const PLAYBACK_SETTINGS_KEY = "tvbox.playback.v1";
export type PlaybackSettings = {
  /** 版本 1：仅包含当前浏览器的自动下一集偏好。 */
  version: 1;
  /** true：正常结束后自动下一集；false：结束后等待用户操作。 */
  autoNext: boolean;
};
export function decodePlaybackSettings(raw: string | null): PlaybackSettings {
  if (!raw) return { version: 1, autoNext: true };
  const value = JSON.parse(raw);
  if (!value || value.version !== 1 || typeof value.autoNext !== "boolean")
    throw Error("自动连播设置无法读取。");
  return { version: 1, autoNext: value.autoNext };
}
