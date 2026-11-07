# Noticias del Gran Concepción

Página con las noticias de seis medios de la zona, revisadas cada 10 minutos:
El Conquistador, Radio UdeC, Diario Concepción, TVU, BioBioChile y Canal 9.

## Qué hay en esta carpeta

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La página. Se abre con doble clic o se sube a tu espacio web. |
| `scraper/scrape.mjs` | El lector que visita los medios y arma `noticias.json`. Lo ejecuta GitHub, no tú. |
| `.github/workflows/actualizar.yml` | La tarea que le dice a GitHub que corra el lector cada 10 minutos. |

## Puesta en marcha (una sola vez, todo desde el navegador)

1. **Crea el repositorio.** En github.com, con tu cuenta `rormenom`, crea un repositorio
   **público** llamado `noticias-conce` (sin README).
2. **Sube los archivos.** En el repositorio: *Add file → Upload files* y arrastra **el
   contenido completo** de esta carpeta (incluida la carpeta `.github`). Pulsa *Commit changes*.
   - Si la carpeta `.github` no se sube al arrastrar: entra a *Actions → set up a workflow
     yourself*, nómbralo `actualizar.yml`, pega el contenido de ese archivo y guarda.
3. **Da permiso de escritura.** *Settings → Actions → General → Workflow permissions* →
   marca **Read and write permissions** → *Save*.
4. **Primera ejecución.** *Actions → Actualizar noticias → Run workflow*. En 1–2 minutos
   aparece `noticias.json` en el repositorio. Desde ahí se actualiza solo cada 10 minutos.
5. **Abre la página.** Doble clic en `index.html`, o súbelo a
   `https://www2.udec.cl/~rormeno/noticias/` como haces con tus otras páginas.

Mientras el repositorio no esté listo, la página igual funciona en modo directo, pero
solo muestra El Conquistador y Radio UdeC (verás un aviso naranjo).

## Cómo se comporta

- La página revisa si hay noticias nuevas cada 10 minutos (y al volver a la pestaña).
  Las nuevas aparecen marcadas como **NUEVO**, con un aviso abajo y un contador en el título.
- En **Deportes** y **Cultura** se muestra primero lo de la zona; la casilla
  *Solo de la zona* oculta el resto.
- Los botones con nombres de medios permiten ocultar o mostrar cada fuente.
- El pie de página indica qué medios respondieron en la última revisión.
- El lector respeta el `robots.txt` de cada sitio: si un medio bloquea el acceso
  automático, esa parte se omite.

## Si cambias el nombre del repositorio

Edita en `index.html` la línea que dice
`https://raw.githubusercontent.com/rormenom/noticias-conce/main/noticias.json`.

## Notas

- GitHub a veces atrasa unos minutos las tareas programadas; es normal.
- Solo se guarda un cambio en el repositorio cuando hay noticias nuevas.
- Si un medio cambia el diseño de su sitio y deja de aparecer, el resto sigue funcionando.
