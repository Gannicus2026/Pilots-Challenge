# Pilots-Challengue
FO Party Hard


## Recuperación y sesiones

En **Acceso organizador**, ingresa el correo de tu cuenta y pulsa **Recuperar contraseña**. Abre el enlace del correo; la aplicación mostrará el formulario para establecer y confirmar una contraseña de al menos 12 caracteres. Después de guardarla, ingresa nuevamente como organizador. La contraseña se envía directamente a Supabase Auth y nunca se guarda en el repositorio.

Mantén `https://gannicus2026.github.io/Pilots-Challenge/` entre las Redirect URLs autorizadas de Supabase Auth. No se necesitan claves secretas ni cambios en tablas o usuarios para esta actualización. Si el enlace venció o ya se utilizó, solicita uno nuevo. El formulario se habilita al recibir el evento de recuperación de Supabase y comprueba la sesión antes de actualizar la contraseña.

Ambos paneles tienen cierre de sesión para este dispositivo. Al cerrar una sesión anónima, sus registros y puntaje permanecen en la base de datos, pero no será posible recuperar ese acceso con el pseudónimo. La aplicación pide confirmación antes de salir o cambiar al acceso de organizador.

La clave `sb_publishable` del cliente es pública. La autorización de datos depende de las políticas RLS y de las funciones de Supabase; ocultar botones no reemplaza esas políticas. Nunca agregues `service_role`, claves `sb_secret` o contraseñas al código.

### Verificación local

Ejecuta `node --check app.js` y `node --test tests/auth.test.cjs`. Las pruebas usan un cliente simulado y no cambian cuentas ni datos reales. La prueba completa por correo y el ingreso con la nueva contraseña deben realizarse con el propietario de la cuenta.
