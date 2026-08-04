// The 9 weekly sessions. Mon-Fri are one session each; Sat & Sun split afternoon/evening.
export const SESSIONS = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
  'Saturday Afternoon', 'Saturday Evening', 'Sunday Afternoon', 'Sunday Evening',
];

/** Best guess for the current session from the clock (evening = 5pm and later). */
export function suggestSession(d = new Date()) {
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (day >= 1 && day <= 5) return names[day];
  return names[day] + (d.getHours() >= 17 ? ' Evening' : ' Afternoon');
}
