export const LOCAL_MEDIA_SCHEME = 'flux-local'

export function buildLocalMediaUrl(absolutePath: string): string {
  return `${LOCAL_MEDIA_SCHEME}://media?path=${encodeURIComponent(absolutePath)}`
}
