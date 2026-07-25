import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * The marketing site is open; everything that needs a login is not.
 *
 * The portal paths carry patient data behind auth - they'd never serve a
 * crawler anything, but keeping them out of the index also keeps staff login
 * screens off search results, where they only ever attract the wrong traffic.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/admin", "/reception", "/labs", "/pharmacy",
          // CAREFUL: Disallow is a PREFIX match, so a bare "/doctor" would also
          // block "/doctors" and every doctor profile - the exact pages this
          // site most wants indexed. Anchor the portal path instead.
          "/doctor$", "/doctor/",
          "/portal/profile",
          "/print/",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
