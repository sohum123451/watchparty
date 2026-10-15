$code = @"
using System;
using System.IO;
using System.IO.Compression;
using System.Text;

public class PngMaker {
    private static uint[] crcTable;

    static PngMaker() {
        crcTable = new uint[256];
        for (uint i = 0; i < 256; i++) {
            uint c = i;
            for (int k = 0; k < 8; k++) {
                if ((c & 1) != 0) {
                    c = 0xedb88320U ^ (c >> 1);
                } else {
                    c = c >> 1;
                }
            }
            crcTable[i] = c;
        }
    }

    private static uint Crc32(byte[] data, int offset, int length) {
        uint c = 0xffffffffU;
        for (int i = offset; i < offset + length; i++) {
            c = crcTable[(c ^ data[i]) & 0xff] ^ (c >> 8);
        }
        return c ^ 0xffffffffU;
    }

    private static uint Adler32(byte[] data) {
        uint a = 1, b = 0;
        for (int i = 0; i < data.Length; i++) {
            a = (a + data[i]) % 65521;
            b = (b + a) % 65521;
        }
        return (b << 16) | a;
    }

    private static void WriteChunk(BinaryWriter w, string type, byte[] data) {
        int len = data == null ? 0 : data.Length;
        w.Write((byte)(len >> 24));
        w.Write((byte)((len >> 16) & 0xff));
        w.Write((byte)((len >> 8) & 0xff));
        w.Write((byte)(len & 0xff));

        byte[] typeBytes = Encoding.ASCII.GetBytes(type);
        w.Write(typeBytes);

        if (len > 0) w.Write(data);

        byte[] crcBuf = new byte[4 + len];
        Buffer.BlockCopy(typeBytes, 0, crcBuf, 0, 4);
        if (len > 0) Buffer.BlockCopy(data, 0, crcBuf, 4, len);

        uint crc = Crc32(crcBuf, 0, crcBuf.Length);
        w.Write((byte)(crc >> 24));
        w.Write((byte)((crc >> 16) & 0xff));
        w.Write((byte)((crc >> 8) & 0xff));
        w.Write((byte)(crc & 0xff));
    }

    public static void GenerateIcon(int size, string path) {
        int width = size;
        int height = size;
        byte[] raw = new byte[height * (width * 4 + 1)];
        int idx = 0;
        int radius = (int)(size * 0.22);

        for (int y = 0; y < height; y++) {
            raw[idx++] = 0; // Filter None
            for (int x = 0; x < width; x++) {
                int left = radius;
                int right = width - 1 - radius;
                int top = radius;
                int bottom = height - 1 - radius;
                bool inCorner = false;
                double dist = 0.0;

                if (x < left && y < top) {
                    dist = Math.Sqrt((x - left)*(x - left) + (y - top)*(y - top));
                    inCorner = true;
                } else if (x > right && y < top) {
                    dist = Math.Sqrt((x - right)*(x - right) + (y - top)*(y - top));
                    inCorner = true;
                } else if (x < left && y > bottom) {
                    dist = Math.Sqrt((x - left)*(x - left) + (y - bottom)*(y - bottom));
                    inCorner = true;
                } else if (x > right && y > bottom) {
                    dist = Math.Sqrt((x - right)*(x - right) + (y - bottom)*(y - bottom));
                    inCorner = true;
                }

                if (inCorner && dist > radius) {
                    raw[idx++] = 0; raw[idx++] = 0; raw[idx++] = 0; raw[idx++] = 0;
                    continue;
                }

                double nx = (x - width / 2.0) / (width / 2.0);
                double ny = (y - height / 2.0) / (height / 2.0);

                bool inPlay = (nx >= -0.32 && nx <= 0.38 &&
                               ny >= -0.45 * (1.0 - (nx - -0.32)/0.70) &&
                               ny <= 0.45 * (1.0 - (nx - -0.32)/0.70));

                if (inPlay) {
                    raw[idx++] = 255; raw[idx++] = 255; raw[idx++] = 255; raw[idx++] = 255;
                } else {
                    double t = (double)(x + y) / (width + height);
                    byte r = (byte)Math.Round(99.0 + (139.0 - 99.0) * t);
                    byte g = (byte)Math.Round(102.0 + (92.0 - 102.0) * t);
                    byte b = (byte)Math.Round(241.0 + (246.0 - 241.0) * t);
                    raw[idx++] = r; raw[idx++] = g; raw[idx++] = b; raw[idx++] = 255;
                }
            }
        }

        byte[] deflated;
        using (MemoryStream ms = new MemoryStream()) {
            using (DeflateStream def = new DeflateStream(ms, CompressionMode.Compress, true)) {
                def.Write(raw, 0, raw.Length);
            }
            deflated = ms.ToArray();
        }

        uint adler = Adler32(raw);
        byte[] zlib = new byte[2 + deflated.Length + 4];
        zlib[0] = 0x78;
        zlib[1] = 0x01;
        Buffer.BlockCopy(deflated, 0, zlib, 2, deflated.Length);
        int aOffset = 2 + deflated.Length;
        zlib[aOffset] = (byte)(adler >> 24);
        zlib[aOffset + 1] = (byte)((adler >> 16) & 0xff);
        zlib[aOffset + 2] = (byte)((adler >> 8) & 0xff);
        zlib[aOffset + 3] = (byte)(adler & 0xff);

        using (FileStream fs = new FileStream(path, FileMode.Create))
        using (BinaryWriter w = new BinaryWriter(fs)) {
            w.Write(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 });

            byte[] ihdr = new byte[13];
            ihdr[0] = (byte)(width >> 24); ihdr[1] = (byte)((width >> 16) & 0xff);
            ihdr[2] = (byte)((width >> 8) & 0xff); ihdr[3] = (byte)(width & 0xff);
            ihdr[4] = (byte)(height >> 24); ihdr[5] = (byte)((height >> 16) & 0xff);
            ihdr[6] = (byte)((height >> 8) & 0xff); ihdr[7] = (byte)(height & 0xff);
            ihdr[8] = 8;  // bit depth
            ihdr[9] = 6;  // RGBA
            ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
            WriteChunk(w, "IHDR", ihdr);
            WriteChunk(w, "IDAT", zlib);
            WriteChunk(w, "IEND", null);
        }
    }
}
"@

Add-Type -TypeDefinition $code -Language CSharp

$iconsDir = Join-Path $PSScriptRoot "..\icons"
if (-not (Test-Path $iconsDir)) {
    New-Item -ItemType Directory -Path $iconsDir -Force | Out-Null
}

foreach ($s in @(16, 48, 128)) {
    $dest = Join-Path $iconsDir "icon-$s.png"
    [PngMaker]::GenerateIcon($s, $dest)
    Write-Host "Created $dest"
}
