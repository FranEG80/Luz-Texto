# Luz & Texto

Aplicación web para catalogar lotes de fotos y vídeos con ayuda de un modelo de visión o multimodal. Genera un título, una descripción y palabras clave para cada archivo, permite revisarlos y los incrusta en los medios antes de descargarlos en un único ZIP.

Puede trabajar con OpenAI o con un VLM ejecutado localmente en LM Studio. Los archivos se procesan uno a uno, con trazas por elemento y control independiente sobre qué medios se analizan y cuáles se exportan.

## Funciones principales

- Importación conjunta de fotos y vídeos en formatos HEIC, HEIF, JPEG, PNG, WebP, MOV y MP4.
- Generación de `title`, `caption` y hasta 10 `keywords` mediante visión artificial.
- Cola secuencial: cada elemento termina antes de comenzar el siguiente.
- Selección individual o masiva de los archivos que se quieren analizar y descargar.
- Regeneración y reintento independientes por elemento.
- Edición manual de título, caption y keywords antes de exportar.
- Descarga inmediata de los metadatos generados en JSON, incluso con el lote todavía en curso.
- Extracción de GPS y enriquecimiento opcional con ubicación y lugares cercanos.
- Escritura de metadatos en las fotografías y los vídeos resultantes.
- Optimización opcional a WebP y MP4.
- Renombrado opcional a `IMG_YYYYMMDD_HHMMSS` según la fecha de captura.
- Protección contra dobles clics durante la generación y la creación del ZIP.

## Flujo de trabajo

1. Arrastra los archivos sobre la página o pulsa **Elegir archivos**.
2. Marca como **Incluido** únicamente lo que quieras procesar. Los controles **Todo** y **Ninguno** modifican la selección completa.
3. Pulsa **Generar selección**. La aplicación analiza los elementos seleccionados de forma secuencial.
4. Si algunos ya estaban listos, el botón cambia a **Completar selección** y procesa solo los pendientes. Cuando todos los seleccionados están terminados aparece **Selección completa** y el botón queda desactivado.
5. Revisa y edita los resultados. **Regenerar** vuelve a analizar un único elemento; si falla, **Reintentar** repite ese análisis.
6. Pulsa **Descargar JSON** en cualquier momento para guardar el progreso ya generado.
7. Activa, si lo necesitas, **Optimizar archivos** o **Renombrar por fecha y hora**.
8. Pulsa **Descargar N en ZIP**.

Un elemento no seleccionado puede quedarse sin caption y no bloquea la descarga. El ZIP solo incluye los elementos seleccionados y se habilita cuando todos ellos tienen título y caption.

Para admitir lotes grandes sin renunciar a la velocidad, la exportación prepara hasta cinco originales en paralelo y muestra el progreso en pantalla. Cada archivo viaja en una petición independiente para evitar multipart gigantes. Al finalizar crea un único ZIP y lo transmite directamente a la descarga, sin reunir antes todos los originales ni el ZIP completo en la memoria del navegador.

El JSON contiene todos los elementos de la sesión, incluidos su estado y selección, los datos básicos del archivo, título, caption, keywords y cualquier error. No incluye el contenido binario de las fotos o vídeos y se puede descargar mientras continúa el análisis en segundo plano.

Durante una generación puedes pulsar **Pausar**. El análisis en curso se cancela y los elementos que no hayan terminado permanecen disponibles para continuar después.

## Formatos y resultado

| Entrada | Análisis visual | Sin optimización | Con optimización |
| --- | --- | --- | --- |
| HEIC / HEIF | Copia WebP interna | Conserva su formato | WebP, calidad 75 |
| JPEG / JPG | Copia WebP interna | Conserva su formato | WebP, calidad 75 |
| PNG | Copia WebP interna | Conserva su formato | WebP, calidad 75 |
| WebP | Copia WebP interna | Conserva su formato | Se conserva sin recomprimir |
| MOV | Fotogramas al 20 %, 50 % y 80 % | MOV | MP4 sin recodificar audio ni vídeo |
| MP4 | Fotogramas al 20 %, 50 % y 80 % | MP4 | Se conserva como MP4 sin recodificar |

La copia visual enviada al modelo nunca sustituye al archivo descargado. En imágenes se aplica la orientación EXIF, se eliminan los metadatos de esa copia y se limita su lado mayor a 2048 píxeles de forma predeterminada. La conversión final a WebP no reduce la resolución original.

La descarga se llama `luz-y-texto-YYYY-MM-DD.zip`. No se añade un JSON auxiliar: los datos se escriben dentro de los propios archivos.

### Renombrado por fecha y hora

Al activar esta opción, los archivos del ZIP reciben nombres como:

```text
IMG_20260711_082945.webp
IMG_20260711_115336.mp4
```

La aplicación busca primero una fecha de captura o creación en los metadatos del medio. Si no existe, utiliza la fecha del archivo recibida por el navegador. Las colisiones no sobrescriben contenido: se resuelven con sufijos como `_02`, `_03`, etc.

## Metadatos escritos

Antes de descargar puedes modificar cualquiera de los campos generados.

En fotografías se escriben variantes compatibles de:

- Caption: `ImageDescription`, `Description` y `Caption-Abstract`.
- Título: `Title`, `XPTitle` y `ObjectName`.
- Keywords: `XMP-dc:Subject`, como lista única para evitar duplicados en Finder.

Además, se preservan cuando existen la fecha de captura, fabricante, cámara, objetivo, ISO, apertura, exposición, distancia focal, GPS y valoración.

En MOV y MP4 se escriben `DisplayName`, `Title`, `Description` y `Keywords` en el espacio `QuickTime Keys`, compatible con las aplicaciones multimedia de Apple. FFmpeg copia los streams de vídeo y audio, junto con los metadatos de origen, por lo que no hay una recodificación del contenido audiovisual.

Si el archivo ya tiene título o keywords, esos valores tienen prioridad sobre la propuesta del modelo. El caption sí se genera y todos los campos se pueden corregir en la interfaz.

## Instalación

### Requisitos

- Node.js 20.9 o posterior.
- ImageMagick con soporte para HEIC y WebP.
- FFmpeg y FFprobe.
- Una clave de OpenAI o un servidor de LM Studio con un modelo de visión cargado.

En macOS, los binarios multimedia se pueden instalar con Homebrew:

```bash
brew install imagemagick ffmpeg
```

Comprueba los formatos disponibles en ImageMagick:

```bash
magick -list format | rg 'HEIC|WEBP'
```

### Inicio rápido

```bash
npm install
cp .env.example .env.local
npm run dev
```

Configura uno de los proveedores descritos a continuación y abre [http://localhost:3000](http://localhost:3000).

Para ejecutar la compilación de producción:

```bash
npm run build
npm run start
```

## Proveedores de captions

El proveedor se elige en el servidor mediante `CAPTION_PROVIDER`. No expongas ninguna clave en variables con prefijo `NEXT_PUBLIC_`.

### OpenAI

```env
CAPTION_PROVIDER=openai
OPENAI_API_KEY=tu-clave
OPENAI_MODEL=gpt-5.6-luna
```

`OPENAI_API_KEY` es obligatoria en este modo. El modelo debe aceptar imágenes y respuestas estructuradas.

### Modelos recomendados

Estas recomendaciones sirven para el caso de uso de la aplicación: describir una imagen, devolver un JSON breve y generar títulos y keywords en español. Elige siempre un modelo con entrada de imagen; un LLM solo de texto no podrá analizar los archivos.

| Entorno | Modelo | Cuándo elegirlo |
| --- | --- | --- |
| OpenAI | `gpt-5.4` | Mejor elección cuando prima la calidad y la interpretación de escenas complejas. Admite imágenes y salidas estructuradas. |
| OpenAI | `gpt-5.4-mini` | Alternativa para lotes grandes cuando importan especialmente el coste y la velocidad. |
| LM Studio | `qwen/qwen3.6-35b-a3b` con visión | Recomendado para máxima calidad local si el equipo dispone de memoria suficiente. Ha sido probado en esta aplicación para captions, títulos y keywords. |
| LM Studio | `qwen2-vl-2b-instruct` | Opción ligera para probar el flujo, equipos con recursos contenidos o validaciones rápidas. |
| LM Studio | Familia Qwen3-VL | Alternativa local sólida si se necesita un VLM específicamente orientado a visión. Elige una variante y cuantización que quepan en el equipo. |

Los identificadores exactos de los modelos locales dependen del repositorio y de la cuantización instalada. Copia en `LM_STUDIO_MODEL` el identificador que muestra el servidor de LM Studio, no solo el nombre comercial. LM Studio documenta el uso de VLMs con JPEG, PNG y WebP; la aplicación le entrega las copias en WebP. Consulta la [comparativa actual de modelos de OpenAI](https://developers.openai.com/api/docs/models/compare) y la [guía de entrada de imágenes de LM Studio](https://lmstudio.ai/docs/python/llm-prediction/image-input) si vas a cambiar de familia de modelos.

### LM Studio

1. Carga en LM Studio un VLM capaz de recibir imágenes.
2. Inicia el servidor local.
3. Copia el identificador exacto del modelo en `LM_STUDIO_MODEL`.

```env
CAPTION_PROVIDER=lmstudio
LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1
LM_STUDIO_MODEL=identificador-del-vlm-cargado
LM_STUDIO_API_KEY= // solo si se activa la opción de
```

El adaptador utiliza la API nativa `/api/v1/chat` y realiza dos etapas: un análisis visual y una respuesta final estructurada. Consulta la tabla anterior para elegir un VLM según la calidad y los recursos disponibles.

Si el modelo razona durante demasiado tiempo y no llega al JSON final, aumenta `LM_STUDIO_MAX_OUTPUT_TOKENS` o `LM_STUDIO_FINAL_OUTPUT_TOKENS`.

## Variables de entorno

Todas las opciones disponibles están documentadas en [`.env.example`](./.env.example).

| Variable | Valor predeterminado | Uso |
| --- | --- | --- |
| `CAPTION_PROVIDER` | `openai` | Proveedor: `openai` o `lmstudio`. |
| `OPENAI_API_KEY` | — | Clave obligatoria al usar OpenAI. |
| `OPENAI_MODEL` | `gpt-5.6-luna` | Modelo de visión de OpenAI. |
| `LM_STUDIO_BASE_URL` | `http://127.0.0.1:1234/v1` | Dirección del servidor de LM Studio. |
| `LM_STUDIO_MODEL` | — | Identificador obligatorio del VLM local. |
| `LM_STUDIO_API_KEY` | — | Clave opcional si el servidor local la exige. |
| `LM_STUDIO_MAX_OUTPUT_TOKENS` | `420` | Presupuesto de salida para el análisis inicial. |
| `LM_STUDIO_FINAL_OUTPUT_TOKENS` | `180` | Presupuesto de la respuesta JSON final. |
| `VISION_MAX_DIMENSION` | `2048` | Lado máximo de la copia para visión; se limita al rango 512–3072. |
| `MAGICK_PATH` | `magick` | Ruta o nombre del ejecutable de ImageMagick. |
| `FFMPEG_PATH` | `ffmpeg` | Ruta o nombre del ejecutable de FFmpeg. |
| `FFPROBE_PATH` | `ffprobe` | Ruta o nombre del ejecutable de FFprobe. |
| `NOMINATIM_USER_AGENT` | `luz-texto/1.0` | Identificación de las consultas de geocodificación. |
| `CAPTION_ERROR_LOGS` | `true` | Activa el registro persistente de errores del backend. |

Después de cambiar `.env.local`, reinicia el servidor de desarrollo.

## GPS, servicios externos y privacidad

El procesamiento multimedia, la extracción de metadatos y la creación del ZIP se realizan en el servidor donde se ejecuta la aplicación. Los temporales se eliminan al terminar cada operación.

El proveedor de IA recibe:

- una copia WebP optimizada de la foto, o tres copias WebP extraídas del vídeo;
- instrucciones para producir título, caption y keywords;
- si existe GPS, un contexto textual con las coordenadas, la ubicación resuelta y hasta tres lugares cercanos.

Con OpenAI, ese contenido se envía a OpenAI. Con LM Studio en `127.0.0.1`, la inferencia permanece en la máquina local.

Cuando un archivo contiene GPS, el servidor consulta:

- Nominatim de OpenStreetMap para la geocodificación inversa. Las peticiones se serializan con una separación aproximada de 1,1 segundos y se almacenan temporalmente en caché.
- La Wikipedia en español para buscar hasta tres puntos de interés situados a un máximo de 1 km.

Ambas consultas reciben las coordenadas. Si alguno de estos servicios falla, el análisis continúa sin esa información. No se realizan consultas de ubicación para archivos sin GPS.

Los errores persistidos en `logs/caption-errors.ndjson` no incluyen imágenes ni metadatos completos. Usa `CAPTION_ERROR_LOGS=false` para desactivar este archivo.

## Límites

- Hasta 200 archivos en una sesión de la interfaz.
- Hasta 50 MB por fotografía.
- Hasta 500 MB por vídeo.
- Hasta 10 keywords por elemento.
- Formatos admitidos: HEIC, HEIF, JPEG, JPG, PNG, WebP, MOV y MP4.

Los archivos que no cumplan el formato o el tamaño se descartan al añadirlos y se muestra un aviso en la página.

## Trazas y diagnóstico

Cada análisis utiliza un identificador de traza compartido entre el navegador y el servidor. En la consola aparecen mensajes similares a:

```text
[media:3d8…] IMG_0250.mov · análisis solicitado
[media:3d8…] IMG_0250.mov · respuesta 200 en 18.4 s
[media:ZIP] +0.6s Exportación · 1/5: preparando IMG_0250.mov
```

Las trazas del servidor detallan la lectura EXIF, GPS, Nominatim, Wikipedia, extracción de fotogramas, preparación para visión, petición al proveedor y escritura del ZIP.

### Problemas habituales

**Solo aparece un elemento como “Analizando”**

Es el comportamiento esperado: la cola es secuencial. Al finalizar, pasa automáticamente al siguiente elemento seleccionado.

**El botón muestra “Selección completa”**

Todos los elementos seleccionados ya tienen título y caption. Deselecciona o edita un elemento, añade archivos nuevos o usa **Regenerar** sobre una tarjeta concreta.

**No se puede descargar el ZIP**

Comprueba que haya al menos un elemento seleccionado y que todos los seleccionados estén en estado **Listo**. Los elementos no incluidos no bloquean la descarga.

**LM Studio no responde**

Verifica que el servidor esté iniciado, que `LM_STUDIO_MODEL` coincida con el modelo cargado y que sea un modelo con visión. Revisa también la URL y los límites de tokens.

**Falla una foto HEIC o la optimización**

Ejecuta `magick -list format` y confirma que ImageMagick tenga soporte de lectura para HEIC y de escritura para WebP.

**Falla el análisis o la conversión de un vídeo**

Comprueba `ffmpeg -version` y `ffprobe -version`, o configura las rutas explícitas con `FFMPEG_PATH` y `FFPROBE_PATH`.

**Necesito localizar un error del proveedor**

Busca el identificador mostrado en la interfaz dentro de la consola del servidor y, si está habilitado, en `logs/caption-errors.ndjson`.

## Comandos del proyecto

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Inicia Next.js en modo desarrollo. |
| `npm run build` | Genera la compilación de producción. |
| `npm run start` | Sirve una compilación ya generada. |
| `npm run lint` | Ejecuta ESLint sobre el proyecto. |
| `npm run graph` | Inicia la interfaz local del grafo de código. |

## Estructura principal

```text
app/
├── page.tsx                         # Interfaz, selección, cola y descarga
└── api/
    ├── media/
    │   ├── analyze/route.ts         # Análisis de una foto o un vídeo
    │   ├── export/route.ts          # Creación del ZIP
    │   └── lib.ts                   # EXIF, GPS, ImageMagick, FFmpeg y ZIP
    └── caption/
        ├── logger.ts                # Registro seguro de errores
        └── providers/               # OpenAI, LM Studio y esquemas comunes
```

La interfaz llama a `/api/media/analyze` una vez por elemento y a `/api/media/export` una vez por descarga. Mientras una de estas operaciones está activa, los controles correspondientes permanecen bloqueados para impedir peticiones duplicadas.
