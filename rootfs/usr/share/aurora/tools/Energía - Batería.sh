#!/bin/sh
exec foot -e sh -c 'aurora power battery && echo "Modo Batería aplicado." || echo "No se pudo cambiar el modo."; sleep 3'
