from urllib.parse import urlparse

from rest_framework.pagination import PageNumberPagination


class RelativePageNumberPagination(PageNumberPagination):
    """
    PageNumberPagination that returns *relative* next/previous links.

    DRF's default builds absolute URLs from the request's Host header. In
    development the backend is reachable at 127.0.0.1:8009 while the SPA is
    served from localhost:3009, so those absolute links point at a different
    origin than the page that received them. Following them is a cross-origin
    request that the browser blocks (CORS).

    Returning path-relative links fixes this at the source: the client resolves
    them against its own origin, so in dev they go through the CRA proxy, and in
    production they work because the SPA and API share an origin (or a proxy).
    """

    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100

    def get_next_link(self):
        url = super().get_next_link()
        return self._relativize(url) if url else None

    def get_previous_link(self):
        url = super().get_previous_link()
        return self._relativize(url) if url else None

    @staticmethod
    def _relativize(url):
        parsed = urlparse(url)
        if not parsed.path:
            return url
        return f"{parsed.path}?{parsed.query}" if parsed.query else parsed.path
