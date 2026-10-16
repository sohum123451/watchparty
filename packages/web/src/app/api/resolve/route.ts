import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { url } = await req.json().catch(() => ({ url: '' }));
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const cleanUrl = url.trim();

    // YouTube regex
    const ytMatch = cleanUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
    if (ytMatch) {
      const id = ytMatch[1];
      let title = `YouTube Video (${id})`;
      let author = 'YouTube';

      try {
        const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`, {
          signal: AbortSignal.timeout(2000),
        });
        if (oembedRes.ok) {
          const oembedData = await oembedRes.json();
          if (oembedData.title) title = oembedData.title;
          if (oembedData.author_name) author = oembedData.author_name;
        }
      } catch {
        // Fallback to default title
      }

      return NextResponse.json({
        descriptor: {
          videoId: id,
          provider: 'youtube',
          sourceRef: `https://www.youtube.com/watch?v=${id}`,
          title,
          author,
          thumbnail: `https://img.youtube.com/vi/${id}/mqdefault.jpg`,
        },
      });
    }

    // Direct video stream / MP4 / WebM / HLS
    const isDirectVideo = cleanUrl.match(/\.(mp4|webm|m3u8|mov|ogg)($|\?)/i);
    const fileName = cleanUrl.split('/').pop()?.split('?')[0] || 'Web Video Stream';

    return NextResponse.json({
      descriptor: {
        videoId: `stream_${Date.now()}`,
        provider: 'html5',
        sourceRef: cleanUrl,
        title: isDirectVideo ? decodeURIComponent(fileName) : 'Web Video Stream',
        author: 'Direct Origin',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to resolve URL' }, { status: 500 });
  }
}
