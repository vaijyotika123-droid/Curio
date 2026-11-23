
import { createClient } from "npm:@supabase/supabase-js@2";
import ipaddr from "npm:ipaddr.js@2.2.0";
import {
  connect as tlsConnect,
  checkServerIdentity,
} from "node:tls";

const ALLOWED_USER_ID = "c972600b-4597-4a5b-80ac-bb268a5943c8";

const HOST = "example.com";
const PORT = 443;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

// Connect to the resolved IP and explicitly inspect the peer certificate.
function testTlsIdentity(
  ip: string,
  hostname: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({
      host: ip,
      port: PORT,
      servername: hostname,
      rejectUnauthorized: true,
    });

    socket.once("secureConnect", () => {
      try {
        if (!socket.authorized) {
          throw new Error(
            String(
              socket.authorizationError ?? "Certificate not authorized",
            ),
          );
        }

        const cert = socket.getPeerCertificate();

        if (!cert || Object.keys(cert).length === 0) {
          throw new Error("Server did not provide a peer certificate.");
        }

        const identityError = checkServerIdentity(hostname, cert);

        if (identityError) {
          throw identityError;
        }

        socket.end();
        resolve();
      } catch (error) {
        socket.destroy();
        reject(error);
      }
    });

    socket.once("error", (error) => {
      socket.destroy();
      reject(error);
    });
  });
}

Deno.serve(async (req) => {
  let currentStage = "request-start";

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  if (
    !ALLOWED_USER_ID ||
    ALLOWED_USER_ID === "PASTE_YOUR_USER_UID_HERE"
  ) {
    return respond({ error: "Configure ALLOWED_USER_ID first." }, 500);
  }

  try {
    // 1. Authentication
    currentStage = "authentication";

    const authorization = req.headers.get("Authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return respond({ error: "Missing authorization token." }, 401);
    }

    const token = authorization.slice("Bearer ".length);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return respond({ error: "Authentication failed." }, 401);
    }

    if (data.user.id !== ALLOWED_USER_ID) {
      return respond({ error: "User is not authorized for this test." }, 403);
    }

    // 2. DNS resolution
    currentStage = "dns-resolution";

    const addresses = await Deno.resolveDns(HOST, "A");

    if (addresses.length === 0) {
      return respond({ error: "No IPv4 addresses returned." }, 500);
    }

    // 3. Public IP classification
    currentStage = "ip-address-classification";

    const publicAddresses = addresses.filter((address) => {
      try {
        return ipaddr.parse(address).range() === "unicast";
      } catch {
        return false;
      }
    });

    if (publicAddresses.length === 0) {
      return respond({
        error: "No public IPv4 addresses found.",
        addresses,
      }, 500);
    }

    const selectedIP = publicAddresses[0];

    // 4. Direct TCP connection to the resolved IP
    currentStage = "tcp-connect-original";

    const tcpConnection = await Deno.connect({
      hostname: selectedIP,
      port: PORT,
    });

    let tlsConnection: Deno.TlsConn;

    try {
      // 5. TLS using the original domain as hostname
      currentStage = "tls-handshake-original";

      tlsConnection = await Deno.startTls(tcpConnection, {
        hostname: HOST,
        unsafelyDisableHostnameVerification: false,
      });
    } catch (error) {
      try {
        tcpConnection.close();
      } catch (closeError) {
        console.error("TCP cleanup failed:", closeError);
      }

      throw error;
    }

    currentStage = "cleanup-original-tls";
    tlsConnection.close();

    // 6. Wrong-hostname TLS control
    let wrongHostTcpConnected = false;
    let wrongHostTlsRejected = false;
    let wrongHostError: string | null = null;

    let controlConnection: Deno.Conn | undefined;
    let wrongTls: Deno.TlsConn | undefined;

    try {
      currentStage = "tcp-connect-wrong-host-control";

      controlConnection = await Deno.connect({
        hostname: selectedIP,
        port: PORT,
      });

      wrongHostTcpConnected = true;

      currentStage = "tls-handshake-wrong-host-control";

      wrongTls = await Deno.startTls(controlConnection, {
        hostname: "wrong-hostname.invalid",
        unsafelyDisableHostnameVerification: false,
      });

      wrongTls.close();
    } catch (error) {
      wrongHostTlsRejected = wrongHostTcpConnected;
      wrongHostError = String(error);
    } finally {
      currentStage = "cleanup-wrong-host-control";

      try {
        if (wrongTls) {
          wrongTls.close();
        } else if (controlConnection) {
          controlConnection.close();
        }
      } catch (closeError) {
        console.error("Wrong-host cleanup failed:", closeError);
      }
    }

    // 7. Independent connectTls test using the resolved IP as identity
    const connectTlsControl = {
      success: false,
      error: null as string | null,
    };

    currentStage = "connect-tls-ip-identity-control";

    try {
      const connection = await Deno.connectTls({
        hostname: selectedIP,
        port: PORT,
      });

      connectTlsControl.success = true;
      connection.close();
    } catch (error) {
      connectTlsControl.error = String(error);
    }

    // 8. Node-compatible TLS test with original hostname
    currentStage = "node-tls-original-hostname-test";

    const nodeTlsOriginalHostname = {
      success: false,
      error: null as string | null,
    };

    try {
      await testTlsIdentity(selectedIP, HOST);
      nodeTlsOriginalHostname.success = true;
    } catch (error) {
      nodeTlsOriginalHostname.error = String(error);
    }

    // 9. Node-compatible TLS test with incorrect hostname
    currentStage = "node-tls-wrong-hostname-test";

    const nodeTlsWrongHostname = {
      success: false,
      error: null as string | null,
    };

    try {
      await testTlsIdentity(
        selectedIP,
        "wrong-hostname.invalid",
      );
      nodeTlsWrongHostname.success = true;
    } catch (error) {
      nodeTlsWrongHostname.error = String(error);
    }

    // 10. Build response
    currentStage = "build-success-response";

    return respond({
      authenticated: true,
      user_authorized: true,

      dns: {
        hostname: HOST,
        addresses,
        public_addresses: publicAddresses,
      },

      tcp: {
        direct_ip_connection: "success",
        connected_ip: selectedIP,
        port: PORT,
      },

      tls: {
        original_hostname_verification: "success",
      },

      wrong_hostname_control: {
        tcp_connected: wrongHostTcpConnected,
        tls_rejected: wrongHostTlsRejected,
        error: wrongHostError,
      },

      connect_tls_ip_identity_control: connectTlsControl,

      node_tls_identity_test: {
        original_hostname: nodeTlsOriginalHostname,
        wrong_hostname: nodeTlsWrongHostname,
      },
    });
  } catch (error) {
    console.error("Capability test failed:", {
      stage: currentStage,
      error,
    });

    return respond({
      error: "Capability test failed.",
      stage: currentStage,
      details: String(error),
      stack: error instanceof Error ? error.stack : null,
    }, 500);
  }
});
