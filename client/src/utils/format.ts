export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  if (year === now.getFullYear()) return `${month}-${day}`;
  return `${year}-${month}-${day}`;
}

// 别名，与 formatDate 功能相同
export const formatDistanceToNow = formatDate;

export function formatPhone(phone: string): string {
  if (phone.length !== 11) return phone;
  return `${phone.slice(0, 3)}****${phone.slice(7)}`;
}

export function formatCredits(credits: number): string {
  if (credits >= 10000) return `${(credits / 10000).toFixed(1)}万`;
  return credits.toString();
}

export function formatTime(minutes: number): string {
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  if (remainMinutes === 0) return `${hours}小时`;
  return `${hours}小时${remainMinutes}分钟`;
}
