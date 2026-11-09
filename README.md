# Pilots-Challengue
FO Party Hard


## Recuperación y sesiones

En **Acceso organizador**, ingresa el correo de tu cuenta y pulsa **Recuperar contraseña**. Abre el enlace del correo; la aplicación mostrará el formulario para establecer y confirmar una contraseña de al menos 12 caracteres. Después de guardarla, ingresa nuevamente como organizador. La contraseña se envía directamente a Supabase Auth y nunca se guarda en el repositorio.

Mantén `https://gannicus2026.github.io/Pilots-Challenge/` entre las Redirect URLs autorizadas de Supabase Auth. No se necesitan claves secretas ni cambios en tablas o usuarios para esta actualización. Si el enlace venció o ya se utilizó, solicita uno nuevo. El formulario se habilita al recibir el evento de recuperación de Supabase y comprueba la sesión antes de actualizar la contraseña.

Ambos paneles tienen cierre de sesión para este dispositivo. Al cerrar una sesión anónima, sus registros y puntaje permanecen en la base de datos, pero no será posible recuperar ese acceso con el pseudónimo. La aplicación pide confirmación antes de salir o cambiar al acceso de organizador.

La clave `sb_publishable` del cliente es pública. La autorización de datos depende de las políticas RLS y de las funciones de Supabase; ocultar botones no reemplaza esas políticas. Nunca agregues `service_role`, claves `sb_secret` o contraseñas al código.

### Verificación local

Ejecuta `node --check app.js` y `node --test tests/auth.test.cjs`. Las pruebas usan un cliente simulado y no cambian cuentas ni datos reales. La prueba completa por correo y el ingreso con la nueva contraseña deben realizarse con el propietario de la cuenta.


## Preparación del evento

La aplicación conserva el proyecto y los datos actuales. Los tres niveles de trivia, Verdadero/Falso y los desafíos de objetos se administran desde **Acceso organizador**. El panel muestra cuántos elementos activos tiene cada juego. No se han agregado preguntas o desafíos de contenido sin revisar.

- Registro: pseudónimo de 2 a 24 caracteres y cargo FO/CT. La función `register_participant` establece el puntaje inicial en el servidor.
- Preguntas: completa las cuatro alternativas de trivia, la respuesta correcta, nivel y puntos de 1 a 1000. Para Verdadero/Falso las alternativas se completan automáticamente. Las alternativas se guardan como una lista, compatible con el esquema instalado.
- Disponibilidad: activa o desactiva preguntas y desafíos; desactivarlos conserva sus intentos, evidencias y puntajes.
- Progreso: al volver a un juego se omiten las preguntas ya respondidas. El servidor impide puntuar dos veces por la misma pregunta.
- Evidencias: JPG, PNG o WebP de hasta 5 MB; estados pendiente, aprobada y rechazada. Se permite una evidencia por participante y desafío. Las fotos siguen en un bucket privado y el organizador accede con enlaces temporales. Usa **Actualizar panel** si venció una imagen.
- Ranking: vistas General, FO y CT, actualización manual y posiciones compartidas en empates.
- Invitados: descarga el QR desde el panel, imprime y comparte. `entry-qr.svg` apunta únicamente a la URL pública de GitHub Pages y no depende de un servicio de QR externo.

### Base de datos existente

El archivo `schema.sql` es un antecedente de la instalación inicial. **No lo ejecutes sobre el proyecto actual.** Los ajustes del evento están registrados en `migration_event_configuration.sql` y en las migraciones de Supabase. No recrees tablas ni usuarios para aplicar cambios de la web.

Las vistas públicas exponen solamente preguntas activas sin respuesta correcta y pseudónimos/cargos/puntos del ranking. Son de solo lectura; se mantienen como proyecciones del propietario para evitar dar acceso público a las tablas protegidas. La vista de evidencias del administrador usa permisos del solicitante y RLS. Las funciones de puntaje y revisión validan la identidad/permisos en el servidor y no se pueden invocar sin una sesión. `is_admin` devuelve únicamente un booleano y sigue disponible para la política pública de desafíos.

### Comprobaciones

`node --test tests/auth.test.cjs` verifica recuperación, registro por RPC, doble toque, formatos de opciones, edición, validaciones y ranking. `tests/security.sql` comprueba los permisos y el puntaje con una transacción que revierte todos los datos de prueba. Ejecuta esa prueba desde una conexión administrativa y conserva el `rollback` final.
