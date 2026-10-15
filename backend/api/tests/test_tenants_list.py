from django.test import TestCase

from api.models import Tenant


class TenantListEndpointTests(TestCase):
    def _url(self, params=None):
        url = "/api/tenants/"
        if not params:
            return url
        query = "&".join(f"{k}={v}" for k, v in params.items())
        return f"{url}?{query}"

    def _make_tenants(self, count):
        """Create `count` tenants with distinct, sortable names."""
        Tenant.objects.bulk_create(
            [Tenant(name=f"Tenant {i:03d}") for i in range(count)]
        )

    def test_default_page_size_is_25(self):
        self._make_tenants(200)

        data = self.client.get(self._url()).json()

        self.assertEqual(data["count"], 200)
        self.assertEqual(len(data["results"]), 25)
        self.assertIsNone(data["previous"])
        self.assertIsNotNone(data["next"])

    def test_last_page_returns_the_remainder(self):
        # 200 tenants / 25 per page -> 8 full pages, no remainder. Use 210 so
        # the last page (page 9) has 10.
        self._make_tenants(210)

        data = self.client.get(self._url({"page": 9})).json()

        self.assertEqual(data["count"], 210)
        self.assertEqual(len(data["results"]), 10)
        self.assertIsNone(data["next"])
        self.assertIsNotNone(data["previous"])

    def test_page_size_query_param(self):
        self._make_tenants(200)

        data = self.client.get(self._url({"page_size": 10})).json()

        self.assertEqual(data["count"], 200)
        self.assertEqual(len(data["results"]), 10)

    def test_page_size_is_clamped_to_max(self):
        self._make_tenants(200)

        data = self.client.get(self._url({"page_size": 500})).json()

        self.assertEqual(data["count"], 200)
        self.assertEqual(len(data["results"]), 100)

    def test_ordering_is_stable_no_duplicates_across_pages(self):
        # Tenants with identical names exercise the id tiebreaker.
        self._make_tenants(200)
        Tenant.objects.bulk_create(
            [Tenant(name="Duplicate Name") for _ in range(30)]
        )

        page_one = self.client.get(
            self._url({"ordering": "name", "page": 1, "page_size": 100})
        ).json()
        page_two = self.client.get(
            self._url({"ordering": "name", "page": 2, "page_size": 100})
        ).json()

        ids = [t["id"] for t in page_one["results"] + page_two["results"]]
        self.assertEqual(len(ids), len(set(ids)), "duplicate ids across pages")

        # Names are non-decreasing across the concatenated pages.
        names = [t["name"] for t in page_one["results"] + page_two["results"]]
        self.assertEqual(names, sorted(names))

    # --- Ordering: ?ordering ---

    def _make_unsorted_tenants(self):
        """Tenants whose insertion (id) order differs from name (A–Z) order."""
        Tenant.objects.bulk_create(
            [
                Tenant(name="Charlie"),
                Tenant(name="Alice"),
                Tenant(name="Bob"),
            ]
        )

    def test_default_ordering_is_id_not_name(self):
        # The default is the raw database order (id), NOT alphabetical — so the
        # rows come back in creation order.
        self._make_unsorted_tenants()

        data = self.client.get(self._url()).json()

        names = [t["name"] for t in data["results"]]
        ids = [t["id"] for t in data["results"]]
        self.assertEqual(names, ["Charlie", "Alice", "Bob"])
        self.assertEqual(ids, sorted(ids))

    def test_ordering_id_matches_default(self):
        self._make_unsorted_tenants()

        default = self.client.get(self._url()).json()
        explicit = self.client.get(self._url({"ordering": "id"})).json()

        self.assertEqual(
            [t["id"] for t in default["results"]],
            [t["id"] for t in explicit["results"]],
        )

    def test_ordering_name_ascending(self):
        self._make_unsorted_tenants()

        data = self.client.get(self._url({"ordering": "name"})).json()

        names = [t["name"] for t in data["results"]]
        self.assertEqual(names, ["Alice", "Bob", "Charlie"])

    def test_ordering_name_descending(self):
        self._make_unsorted_tenants()

        data = self.client.get(self._url({"ordering": "-name"})).json()

        names = [t["name"] for t in data["results"]]
        self.assertEqual(names, ["Charlie", "Bob", "Alice"])

    def test_invalid_ordering_falls_back_to_default(self):
        self._make_unsorted_tenants()

        # No 400 — an unsupported value silently uses the default (id order).
        response = self.client.get(self._url({"ordering": "bogus; DROP TABLE"}))
        self.assertEqual(response.status_code, 200)

        names = [t["name"] for t in response.json()["results"]]
        self.assertEqual(names, ["Charlie", "Alice", "Bob"])

    def test_ordering_name_keeps_id_tiebreaker(self):
        # Equal names must stay stably ordered by id so pagination is stable.
        Tenant.objects.bulk_create([Tenant(name="SameName") for _ in range(5)])

        data = self.client.get(
            self._url({"ordering": "name", "page_size": 100})
        ).json()

        ids = [t["id"] for t in data["results"]]
        self.assertEqual(ids, sorted(ids))

    def test_ordering_survives_onto_next_link(self):
        self._make_tenants(30)

        data = self.client.get(self._url({"ordering": "-name"})).json()

        self.assertIsNotNone(data["next"])
        # The ordering param is carried forward on the server-built next link.
        self.assertIn("ordering=-name", data["next"])

    def test_next_link_is_relative_and_preserves_path(self):
        self._make_tenants(30)

        data = self.client.get(self._url()).json()

        self.assertIsNotNone(data["next"])
        # Path-relative, NOT an absolute URL. Absolute links are built from the
        # request Host and break the SPA behind the dev proxy (CORS).
        self.assertFalse(data["next"].startswith("http"))
        self.assertTrue(data["next"].startswith("/api/"))
        self.assertIn("/api/tenants/", data["next"])
        self.assertIn("page=2", data["next"])

    def test_previous_link_is_relative(self):
        self._make_tenants(30)

        data = self.client.get(self._url({"page": 2})).json()

        self.assertIsNotNone(data["previous"])
        self.assertFalse(data["previous"].startswith("http"))
        self.assertTrue(data["previous"].startswith("/api/"))

    def test_next_link_preserves_query_string(self):
        # The page_size param must survive onto the next link, so paging keeps
        # the caller's chosen page size instead of silently reverting.
        self._make_tenants(200)

        data = self.client.get(self._url({"page_size": 10})).json()

        self.assertIsNotNone(data["next"])
        self.assertIn("page_size=10", data["next"])
        self.assertIn("page=2", data["next"])
        # Still path-relative.
        self.assertTrue(data["next"].startswith("/api/"))

    def test_out_of_range_page_returns_404(self):
        self._make_tenants(30)

        response = self.client.get(self._url({"page": 999}))

        self.assertEqual(response.status_code, 404)

    def test_empty_result_has_zero_count_and_null_links(self):
        data = self.client.get(self._url()).json()

        self.assertEqual(data["count"], 0)
        self.assertEqual(data["results"], [])
        self.assertIsNone(data["next"])
        self.assertIsNone(data["previous"])
