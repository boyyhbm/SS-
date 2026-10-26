# Реальные программные замеры

Actual game, software Vulkan/SwiftShader; no physical GPU or target 60 FPS certification. Short rows do not establish a reliable 1% low.

| Пресет | Фактический | Canvas | Кадры | FPS | Кадр, мс | P95, мс | 1% low |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| low | low | 1632 × 918 | 72 | 0.77 | 1290.5 | 1720.8 | недостаточно кадров |
| medium | medium | 1920 × 1080 | 16 | 0.16 | 6132.1 | 11987.9 | недостаточно кадров |
| high | high | 1920 × 1080 | 8 | 0.07 | 14314.7 | 22931.0 | недостаточно кадров |
| ultra | ultra | 1920 × 1080 | 8 | 0.05 | 20951.3 | 25934.8 | недостаточно кадров |
| cinematic | cinematic | 1920 × 1080 | 6 | 0.05 | 20557.7 | 32163.6 | недостаточно кадров |
| auto | low | 1060 × 596 | 87 | 0.97 | 1035.4 | 2013.8 | недостаточно кадров |

Это не игровой ПК. GPU frame time и VRAM недоступны через предоставленный WebGL API. Render main-thread duration включает ожидания драйвера; показатели не выдаются за чистое CPU/GPU время. Сырые кадры и размеры canvas сохранены в performance-report.json.
