"""Cierra el núcleo cuando termina el proceso de la app de escritorio.

Con PyInstaller --onefile hay dos procesos (lanzador + núcleo): si Tauri matara al lanzador,
el núcleo quedaría huérfano ocupando el puerto y la carpeta temporal _MEI no se borraría.
Por eso es el propio núcleo el que sale cuando la app termina (también si la app se cae).
"""

import os
import sys
import threading
import time


def exit_when_parent_dies(pid: int) -> None:
    if sys.platform == "win32":
        import ctypes

        synchronize = 0x00100000
        infinite = 0xFFFFFFFF
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(synchronize, False, pid)
        if not handle:  # la app ya no existe
            os._exit(0)

        def wait() -> None:
            kernel32.WaitForSingleObject(handle, infinite)
            os._exit(0)

    else:

        def wait() -> None:
            while True:
                try:
                    os.kill(pid, 0)
                except OSError:
                    os._exit(0)
                time.sleep(1)

    threading.Thread(target=wait, daemon=True, name="parent-watchdog").start()
