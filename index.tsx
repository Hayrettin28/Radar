
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

// --- Sabitler ---
const WIDTH = 400;
const HEIGHT = 400;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;
const RADIUS = WIDTH / 2 - 10;

// --- Simülasyon Sınıfları ---
class Target {
  x: number;
  y: number;
  dx: number;
  dy: number;
  size: number;

  constructor(randomStart = true) {
    this.size = 3;
    this.reset(randomStart);
  }

  reset(randomStart: boolean) {
    // Rastgele hız ve yön (biraz daha yavaş ve kararlı)
    const speed = 0.3 + Math.random() * 0.5;
    const angle = Math.random() * Math.PI * 2;
    this.dx = Math.cos(angle) * speed;
    this.dy = Math.sin(angle) * speed;

    if (randomStart) {
      // Ekranda rastgele bir yer
      this.x = Math.random() * WIDTH;
      this.y = Math.random() * HEIGHT;
    } else {
      // Ekran dışından içeri sok
      // Basitçe: Hangi yöne gidiyorsa, ters taraftan başlat
      if (Math.abs(this.dx) > Math.abs(this.dy)) {
        // Yatay giriş
        this.x = this.dx > 0 ? -20 : WIDTH + 20;
        this.y = Math.random() * HEIGHT;
      } else {
        // Dikey giriş
        this.x = Math.random() * WIDTH;
        this.y = this.dy > 0 ? -20 : HEIGHT + 20;
      }
    }
  }

  update() {
    this.x += this.dx;
    this.y += this.dy;

    // Ekran dışına çıkarsa (marj payı ile)
    const margin = 50;
    if (
      this.x < -margin || 
      this.x > WIDTH + margin || 
      this.y < -margin || 
      this.y > HEIGHT + margin
    ) {
      // Hedefi sıfırla ve dışarıdan tekrar gönder
      this.reset(false);
    }
  }
}

const App = () => {
  // --- Referanslar ve Durumlar ---
  const rawCanvasRef = useRef<HTMLCanvasElement>(null);
  const procCanvasRef = useRef<HTMLCanvasElement>(null);
  
  const [noiseLevel, setNoiseLevel] = useState<number>(15);
  // Threshold %0-100 arası (UI için), ama mantıkta 0-255 arası kullanacağız
  const [thresholdPercent, setThresholdPercent] = useState<number>(65); 
  const [detectedCount, setDetectedCount] = useState<number>(0);

  // Filtre Durumları
  const [useBlur, setUseBlur] = useState<boolean>(true);
  const [useThreshold, setUseThreshold] = useState<boolean>(true);
  const [useDetection, setUseDetection] = useState<boolean>(true);

  // Simülasyon Durumu
  const targetsRef = useRef<Target[]>([]);
  const angleRef = useRef<number>(0);
  const animationFrameRef = useRef<number>(0);

  // Hedefleri Başlat
  useEffect(() => {
    targetsRef.current = Array.from({ length: 5 }, () => new Target(true));
  }, []);

  // --- Ana Döngü ---
  useEffect(() => {
    const render = () => {
      const rawCanvas = rawCanvasRef.current;
      const procCanvas = procCanvasRef.current;
      if (!rawCanvas || !procCanvas) return;

      const rawCtx = rawCanvas.getContext('2d', { willReadFrequently: true });
      const procCtx = procCanvas.getContext('2d', { willReadFrequently: true });
      if (!rawCtx || !procCtx) return;

      // ==========================================
      // 1. SİMÜLASYON (Ham Radar Görüntüsü)
      // ==========================================
      
      // A. Fosfor Sönümlemesi (İz Bırakma)
      rawCtx.fillStyle = 'rgba(0, 5, 0, 0.06)'; 
      rawCtx.fillRect(0, 0, WIDTH, HEIGHT);

      // B. Hedefleri Çiz
      targetsRef.current.forEach(t => {
        t.update();
        
        // Bloom effect (Parlaklık)
        rawCtx.shadowBlur = 15;
        rawCtx.shadowColor = '#4ade80'; // Açık yeşil gölge
        rawCtx.fillStyle = '#ffffff';   // Beyaz çekirdek
        
        rawCtx.beginPath();
        rawCtx.arc(t.x, t.y, t.size, 0, Math.PI * 2);
        rawCtx.fill();
        
        // Gölgeyi sıfırla
        rawCtx.shadowBlur = 0;
      });

      // C. Dönen Tarama Çizgisi
      angleRef.current = (angleRef.current + 0.04) % (Math.PI * 2);
      const endX = CENTER_X + RADIUS * Math.cos(angleRef.current);
      const endY = CENTER_Y + RADIUS * Math.sin(angleRef.current);
      
      const grad = rawCtx.createLinearGradient(CENTER_X, CENTER_Y, endX, endY);
      grad.addColorStop(0, 'rgba(0, 255, 0, 0.1)');
      grad.addColorStop(1, 'rgba(0, 255, 0, 0.8)');
      
      rawCtx.strokeStyle = grad;
      rawCtx.lineWidth = 2;
      rawCtx.beginPath();
      rawCtx.moveTo(CENTER_X, CENTER_Y);
      rawCtx.lineTo(endX, endY);
      rawCtx.stroke();

      // D. Yapay Gürültü (Atmosferik Parazit)
      const rawImageData = rawCtx.getImageData(0, 0, WIDTH, HEIGHT);
      const pixels = rawImageData.data;
      const noiseDensity = noiseLevel / 2000; 

      for (let i = 0; i < pixels.length; i += 4) {
        if (Math.random() < noiseDensity) {
          const val = Math.random() * 150 + 50;
          pixels[i] = val * 0.5;   // R
          pixels[i + 1] = val;     // G
          pixels[i + 2] = val * 0.5; // B
        }
      }
      rawCtx.putImageData(rawImageData, 0, 0);


      // ==========================================
      // 2. BİLGİSAYARLI GÖRÜ (Pipeline)
      // ==========================================
      
      // Ekranı temizle
      procCtx.clearRect(0, 0, WIDTH, HEIGHT);
      
      // Arka plan (Sadece görsel, algoritmaya dahil değil)
      procCtx.fillStyle = '#020617'; 
      procCtx.fillRect(0, 0, WIDTH, HEIGHT);

      // Maskeleme (Dairesel Alan)
      procCtx.save();
      procCtx.beginPath();
      procCtx.arc(CENTER_X, CENTER_Y, RADIUS, 0, Math.PI * 2);
      procCtx.clip();

      // --- ADIM 1: Gri Tonlama (Preprocessing) ---
      // İşleme için yeni bir buffer oluşturuyoruz
      // rawImageData.data'yı kopyalayarak başlayalım
      const procPixels = new Uint8ClampedArray(pixels); // Kopyala
      const grayBuffer = new Uint8Array(WIDTH * HEIGHT);

      for (let i = 0; i < procPixels.length; i += 4) {
        // İnsan gözüne uygun gri tonlama: 0.3 R + 0.59 G + 0.11 B
        const gray = (procPixels[i] * 0.3 + procPixels[i+1] * 0.59 + procPixels[i+2] * 0.11);
        grayBuffer[i / 4] = gray;
        
        // Görselleştirme için (Eğer diğer filtreler kapalıysa gri hali göster)
        procPixels[i] = gray;
        procPixels[i+1] = gray;
        procPixels[i+2] = gray;
      }

      // --- ADIM 2: Bulanıklaştırma (Noise Reduction) ---
      let processedBuffer = grayBuffer;
      
      if (useBlur) {
        const blurBuffer = new Uint8Array(WIDTH * HEIGHT);
        // Basit Box Blur (3x3)
        // Kenarları ihmal ederek döngüyü hızlı tutuyoruz
        for (let y = 1; y < HEIGHT - 1; y++) {
          for (let x = 1; x < WIDTH - 1; x++) {
            const idx = y * WIDTH + x;
            // 3x3 ortalama
            let sum = 0;
            sum += grayBuffer[idx - WIDTH - 1] + grayBuffer[idx - WIDTH] + grayBuffer[idx - WIDTH + 1];
            sum += grayBuffer[idx - 1]         + grayBuffer[idx]         + grayBuffer[idx + 1];
            sum += grayBuffer[idx + WIDTH - 1] + grayBuffer[idx + WIDTH] + grayBuffer[idx + WIDTH + 1];
            
            blurBuffer[idx] = sum / 9;
          }
        }
        processedBuffer = blurBuffer;
        
        // Görselleştirme güncelle
        if (!useThreshold) {
           for(let i=0; i<WIDTH*HEIGHT; i++) {
             const val = processedBuffer[i];
             procPixels[i*4] = val;
             procPixels[i*4+1] = val;
             procPixels[i*4+2] = val;
           }
        }
      }

      // --- ADIM 3: Eşikleme (Thresholding) ---
      const binaryMap = new Uint8Array(WIDTH * HEIGHT);
      // UI Yüzdesini (0-100) 0-255 değerine çevir
      const thresholdVal = (thresholdPercent / 100) * 255;

      if (useThreshold) {
        for (let i = 0; i < WIDTH * HEIGHT; i++) {
          // Dairesel alan kontrolü (Sadece radarın içini işle)
          const px = i % WIDTH;
          const py = Math.floor(i / WIDTH);
          const dist = Math.sqrt((px-CENTER_X)**2 + (py-CENTER_Y)**2);
          
          if (dist < RADIUS && processedBuffer[i] > thresholdVal) {
             binaryMap[i] = 1; // Nesne
             
             // Görselleştirme: Eşiklenmiş pikselleri mavi/beyaz yap
             // Eğer tespit kapalıysa bu görüntüyü net görelim
             if (!useDetection) {
               procPixels[i*4] = 200;
               procPixels[i*4+1] = 255;
               procPixels[i*4+2] = 255;
             } else {
               // Tespit açıksa arka planda hafif silik göster
               procPixels[i*4] = 20;
               procPixels[i*4+1] = 40;
               procPixels[i*4+2] = 60;
             }
          } else {
             // Arka plan
             if (useDetection || useThreshold) {
                procPixels[i*4] = 10;   // Çok koyu mavi
                procPixels[i*4+1] = 15;
                procPixels[i*4+2] = 25;
             }
          }
        }
      }

      // Buffer'ı Canvas'a bas (Ara görüntüyü görmek için)
      const outputImageData = new ImageData(procPixels, WIDTH, HEIGHT);
      procCtx.putImageData(outputImageData, 0, 0);

      // Grid çizimi (Estetik - her zaman üstte kalsın)
      procCtx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
      procCtx.lineWidth = 1;
      for(let r=50; r<RADIUS; r+=50) {
        procCtx.beginPath();
        procCtx.arc(CENTER_X, CENTER_Y, r, 0, Math.PI * 2);
        procCtx.stroke();
      }
      procCtx.beginPath();
      procCtx.moveTo(CENTER_X, 0); procCtx.lineTo(CENTER_X, HEIGHT);
      procCtx.stroke();
      procCtx.beginPath();
      procCtx.moveTo(0, CENTER_Y); procCtx.lineTo(WIDTH, CENTER_Y);
      procCtx.stroke();


      // --- ADIM 4: Tespit ve İşaretleme (Detection) ---
      let count = 0;
      if (useThreshold && useDetection) {
        const visited = new Uint8Array(WIDTH * HEIGHT);
        const detectedBlobs: {x: number, y: number, w: number, h: number, area: number}[] = [];

        for (let y = 0; y < HEIGHT; y+=2) { 
          for (let x = 0; x < WIDTH; x+=2) {
            const idx = y * WIDTH + x;
            
            if (binaryMap[idx] === 1 && visited[idx] === 0) {
              let minX = x, maxX = x, minY = y, maxY = y;
              let area = 0;
              const stack = [idx];
              visited[idx] = 1;

              while (stack.length > 0) {
                const currIdx = stack.pop()!;
                const currX = currIdx % WIDTH;
                const currY = Math.floor(currIdx / WIDTH);
                area++;
                
                if (currX < minX) minX = currX;
                if (currX > maxX) maxX = currX;
                if (currY < minY) minY = currY;
                if (currY > maxY) maxY = currY;

                const neighbors = [currIdx - 1, currIdx + 1, currIdx - WIDTH, currIdx + WIDTH];
                for (const n of neighbors) {
                  if (n >= 0 && n < binaryMap.length && binaryMap[n] === 1 && visited[n] === 0) {
                    visited[n] = 1;
                    stack.push(n);
                  }
                }
              }

              // Filtreleme Kuralları (Gürültüyü ele, büyük hedefleri al)
              // Blur açıksa gürültü azalır, daha küçük alanları kabul edebiliriz
              const minArea = useBlur ? 5 : 10; 

              if (area > minArea && area < 1000) {
                const w = maxX - minX;
                const h = maxY - minY;
                // Çok uzun ince çizgileri (tarama izi vb) ele
                const ratio = w / (h || 1);
                if (ratio > 0.2 && ratio < 5.0) {
                  detectedBlobs.push({ x: minX, y: minY, w, h, area });
                  count++;
                }
              }
            }
          }
        }

        // Kutuları Çiz
        detectedBlobs.forEach(blob => {
          const cx = blob.x + blob.w / 2;
          const cy = blob.y + blob.h / 2;
          
          const size = Math.max(blob.w, blob.h) + 12;
          const half = size / 2;
          
          procCtx.strokeStyle = '#00ffff'; 
          procCtx.lineWidth = 2;
          procCtx.shadowBlur = 10;
          procCtx.shadowColor = '#00ffff';

          // Köşeli Parantez Çizimi (Lock-on UI)
          // Sol Üst
          procCtx.beginPath();
          procCtx.moveTo(cx - half, cy - half + 6);
          procCtx.lineTo(cx - half, cy - half);
          procCtx.lineTo(cx - half + 6, cy - half);
          procCtx.stroke();
          
          // Sağ Üst
          procCtx.beginPath();
          procCtx.moveTo(cx + half - 6, cy - half);
          procCtx.lineTo(cx + half, cy - half);
          procCtx.lineTo(cx + half, cy - half + 6);
          procCtx.stroke();
          
          // Sol Alt
          procCtx.beginPath();
          procCtx.moveTo(cx - half, cy + half - 6);
          procCtx.lineTo(cx - half, cy + half);
          procCtx.lineTo(cx - half + 6, cy + half);
          procCtx.stroke();

          // Sağ Alt
          procCtx.beginPath();
          procCtx.moveTo(cx + half - 6, cy + half);
          procCtx.lineTo(cx + half, cy + half);
          procCtx.lineTo(cx + half, cy + half - 6);
          procCtx.stroke();

          procCtx.shadowBlur = 0;
          
          // Etiket
          procCtx.fillStyle = '#00ffff';
          procCtx.font = '10px monospace';
          procCtx.fillText(`TGT-${blob.area}`, cx + half + 4, cy);
        });
      }
      setDetectedCount(count);
      
      procCtx.restore(); // Clip bitiş

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [noiseLevel, thresholdPercent, useBlur, useThreshold, useDetection]); 

  return (
    <div style={{ 
      padding: '40px 20px', 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      minHeight: '100vh', 
      boxSizing: 'border-box'
    }}>
      
      {/* Başlık */}
      <div style={{ textAlign: 'center', marginBottom: '30px' }}>
        <h1 style={{ 
          margin: 0, 
          fontSize: '32px', 
          fontWeight: '300',
          color: '#ffffff', 
          letterSpacing: '4px',
          textShadow: '0 0 20px rgba(74, 222, 128, 0.5)'
        }}>
          RADAR SİMÜLASYONU
        </h1>
        <p style={{ margin: '8px 0 0 0', color: '#94a3b8', fontSize: '14px', letterSpacing: '1px' }}>
          GÖRÜNTÜ İŞLEME VE HEDEF TESPİT SİSTEMİ
        </p>
      </div>

      {/* Ana Düzen (Grid) */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'auto auto 250px', // Sol Radar, Sağ Radar, Panel
        gap: '40px',
        maxWidth: '1300px',
        alignItems: 'start',
        justifyContent: 'center'
      }}>
        
        {/* 1. Sol Taraf: Ham Görüntü */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ 
            marginBottom: '15px', 
            fontWeight: '600', 
            color: '#4ade80', 
            letterSpacing: '1px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '14px'
          }}>
            <span style={{ width: '8px', height: '8px', backgroundColor: '#4ade80', borderRadius: '50%', boxShadow: '0 0 10px #4ade80' }}></span>
            HAM SENSÖR VERİSİ
          </div>
          
          <div style={{ position: 'relative' }}>
            <canvas 
              ref={rawCanvasRef} 
              width={WIDTH} 
              height={HEIGHT} 
              style={{ 
                backgroundColor: '#000', 
                borderRadius: '50%', 
                boxShadow: '0 0 40px rgba(0, 255, 0, 0.15)',
              }}
            />
          </div>
        </div>

        {/* 2. Orta: İşlenmiş Görüntü */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ 
            marginBottom: '15px', 
            fontWeight: '600', 
            color: '#38bdf8', 
            letterSpacing: '1px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '14px'
          }}>
            <span style={{ width: '8px', height: '8px', backgroundColor: '#38bdf8', borderRadius: '50%', boxShadow: '0 0 10px #38bdf8' }}></span>
            DİJİTAL TESPİT EKRANI
          </div>
          
          <div style={{ position: 'relative' }}>
            <canvas 
              ref={procCanvasRef} 
              width={WIDTH} 
              height={HEIGHT} 
              style={{ 
                backgroundColor: '#020617', 
                borderRadius: '50%',
                border: '4px solid #1e293b',
                boxShadow: '0 0 40px rgba(56, 189, 248, 0.1)'
              }}
            />
          </div>
        </div>

        {/* 3. Sağ: Kontrol ve Filtre Paneli */}
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '20px',
          width: '100%'
        }}>
          
          {/* A. Filtre Paneli (Pipeline) */}
          <div style={{ 
             background: '#1e293b', 
             borderRadius: '12px', 
             padding: '20px', 
             border: '1px solid #334155',
             boxShadow: '0 10px 30px rgba(0,0,0,0.3)'
          }}>
             <h3 style={{ margin: '0 0 15px 0', fontSize: '14px', color: '#cbd5e1', letterSpacing: '0.5px' }}>
               GÖRÜNTÜ İŞLEME HATTI
             </h3>
             
             <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                
                {/* Filtre 1: Blur */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={useBlur} 
                    onChange={(e) => setUseBlur(e.target.checked)}
                    style={{ accentColor: '#38bdf8', width: '16px', height: '16px' }}
                  />
                  <div>
                    <div style={{ color: useBlur ? '#fff' : '#64748b', fontSize: '14px', fontWeight: '500' }}>Bulanıklaştırma</div>
                    <div style={{ color: '#64748b', fontSize: '11px' }}>Gürültü Azaltma (Blur)</div>
                  </div>
                </label>

                {/* Filtre 2: Threshold */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={useThreshold} 
                    onChange={(e) => setUseThreshold(e.target.checked)}
                    style={{ accentColor: '#38bdf8', width: '16px', height: '16px' }}
                  />
                  <div>
                    <div style={{ color: useThreshold ? '#fff' : '#64748b', fontSize: '14px', fontWeight: '500' }}>Eşikleme</div>
                    <div style={{ color: '#64748b', fontSize: '11px' }}>Threshold Filter</div>
                  </div>
                </label>

                {/* Filtre 3: Detection */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={useDetection} 
                    disabled={!useThreshold} // Threshold kapalıysa tespit yapılamaz
                    onChange={(e) => setUseDetection(e.target.checked)}
                    style={{ accentColor: '#38bdf8', width: '16px', height: '16px' }}
                  />
                  <div>
                    <div style={{ color: useDetection ? '#fff' : '#64748b', fontSize: '14px', fontWeight: '500' }}>Nesne Tespiti</div>
                    <div style={{ color: '#64748b', fontSize: '11px' }}>Blob Detection</div>
                  </div>
                </label>
             </div>
          </div>

          {/* B. Ayarlar Paneli */}
          <div style={{ 
             background: 'linear-gradient(145deg, #1e1e24 0%, #17171d 100%)', 
             borderRadius: '12px', 
             padding: '20px', 
             border: '1px solid #333',
             display: 'flex',
             flexDirection: 'column',
             gap: '20px'
          }}>
            {/* Gürültü */}
            <div>
              <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px', color: '#94a3b8' }}>
                SİNYAL GÜRÜLTÜSÜ
                <span style={{ color: '#ef4444' }}>%{noiseLevel}</span>
              </label>
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={noiseLevel} 
                onChange={(e) => setNoiseLevel(Number(e.target.value))}
                style={{ width: '100%', cursor: 'pointer' }}
              />
            </div>

            {/* Hassasiyet (Artık Yüzde) */}
            <div>
              <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px', color: '#94a3b8' }}>
                HASSASİYET EŞİĞİ
                <span style={{ color: '#38bdf8' }}>%{thresholdPercent}</span>
              </label>
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={thresholdPercent} 
                onChange={(e) => setThresholdPercent(Number(e.target.value))}
                disabled={!useThreshold}
                style={{ width: '100%', cursor: 'pointer', opacity: useThreshold ? 1 : 0.5 }}
              />
            </div>
          </div>

          {/* C. Sonuç Paneli */}
          <div style={{ 
            background: '#0f172a',
            borderRadius: '12px',
            padding: '20px',
            border: '1px solid #1e293b',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '600', letterSpacing: '1px', marginBottom: '5px' }}>
              AKTİF KİLİTLENME
            </div>
            <div style={{ fontSize: '48px', fontWeight: '300', color: '#38bdf8', lineHeight: 1, textShadow: '0 0 20px rgba(56, 189, 248, 0.4)' }}>
              {detectedCount}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);
