#!/bin/sh
exec foot -e sh -c 'aurora power balanced && echo "Modo Equilibrado aplicado." || echo "No se pudo cambiar el modo."; sleep 3'
