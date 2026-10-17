#!/bin/sh
exec aurora-tool sh -c 'aurora power performance && echo "Modo Rendimiento aplicado." || echo "No se pudo cambiar el modo."; sleep 3'
