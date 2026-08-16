# syntax=docker/dockerfile:1
#
# The web client is static files once built, so nothing here needs a Node
# process at runtime — nginx serves the bundle Vite produced in the `core`
# build context. The dev server is a development tool and is not what runs in
# a container.

FROM nginx:alpine
COPY services/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=core /services/web/dist /usr/share/nginx/html
EXPOSE 80
