import { useEffect, useState, type ImgHTMLAttributes } from 'react'
import { ensureImageCached, getCachedImage } from '../store'

export default function StoredImage({ imageId, alt, ...props }: { imageId: string } & ImgHTMLAttributes<HTMLImageElement>) {
  const [source, setSource] = useState({ id: imageId, url: getCachedImage(imageId) || '', failed: false })
  useEffect(() => {
    let active = true
    setSource({ id: imageId, url: getCachedImage(imageId) || '', failed: false })
    void ensureImageCached(imageId).then((url) => { if (active) setSource({ id: imageId, url: url || '', failed: !url }) })
      .catch(() => { if (active) setSource({ id: imageId, url: '', failed: true }) })
    return () => { active = false }
  }, [imageId])
  return source.id === imageId && source.url ? <img {...props} src={source.url} alt={alt} />
    : <span className="inline-flex min-h-20 items-center justify-center p-3 text-xs text-gray-400">{source.failed ? '原图暂不可用' : '正在读取图片…'}</span>
}
