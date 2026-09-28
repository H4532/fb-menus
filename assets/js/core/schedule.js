// FB Menus — "which menu is being served now", computed in the OUTLET's
// timezone so a guest whose phone is still on home time sees the right menu.
import { t } from './i18n.js';
import { time, dayList } from './format.js';

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Current weekday (0 = Sunday) and minutes since midnight in `tz`. */
export function nowIn(tz, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/**
 * Is a single window open? Windows that end before they start run past
 * midnight; `days` refers to the day the window STARTS.
 */
function windowOpen(w, now) {
  const start = toMin(w.start);
  const end = toMin(w.end);
  if (start < end) {
    return w.days.includes(now.day) && now.minutes >= start && now.minutes < end;
  }
  const yesterday = (now.day + 6) % 7;
  return (w.days.includes(now.day) && now.minutes >= start)
      || (w.days.includes(yesterday) && now.minutes < end);
}

/** A menu without schedules is always available. */
export function isServing(menu, now) {
  if (!menu.schedules?.length) return true;
  return menu.schedules.some((w) => windowOpen(w, now));
}

/** The first menu (in admin order) being served now, else the first menu. */
export function pickCurrentMenu(menus, tz) {
  const now = nowIn(tz);
  return menus.find((m) => m.schedules?.length && isServing(m, now))
      || menus.find((m) => isServing(m, now))
      || menus[0];
}

/** Next start time today for a menu that isn't open, or null. */
export function nextStartToday(menu, tz) {
  const now = nowIn(tz);
  const upcoming = (menu.schedules || [])
    .filter((w) => w.days.includes(now.day) && toMin(w.start) > now.minutes)
    .map((w) => w.start)
    .sort();
  return upcoming[0] || null;
}

/** Human description of a menu's serving hours. */
export function describeHours(menu) {
  if (!menu.schedules?.length) return t('all_day');
  return menu.schedules
    .map((w) => {
      const days = w.days.length === 7 ? '' : `${dayList(w.days)} `;
      return `${days}${time(w.start)}–${time(w.end)}`;
    })
    .join(' · ');
}
