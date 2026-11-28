import AuthenticationServices
import CryptoKit
import Nativue
import Security
import UIKit

/// AuthSession (src/index.ts): ASWebAuthenticationSession, which shows the provider's page in a browser the
/// app can't read, and hands back the redirect to the app's scheme.
public final class AuthSessionPlugin: NSObject, NativuePlugin, ASWebAuthenticationPresentationContextProviding {
    private weak var registry: PluginRegistry?
    /// On the main thread: kept while it's open, one at a time.
    private var session: ASWebAuthenticationSession?

    public override init() {}

    public func register(in registry: PluginRegistry) {
        self.registry = registry

        registry.addAsyncFunction("authSession.open") { [unowned self] arguments in
            try await open(arguments[0] as! String, redirectUri: arguments[1] as! String, ephemeral: arguments[2] as! Bool)
        }

        registry.addAsyncFunction("authSession.createPKCE") { _ in
            let codeVerifier = try Self.randomString()
            let codeChallenge = Self.base64URL(Data(SHA256.hash(data: Data(codeVerifier.utf8))))

            return ["codeVerifier": codeVerifier, "codeChallenge": codeChallenge, "codeChallengeMethod": "S256"]
        }

        registry.addAsyncFunction("authSession.randomString") { _ in try Self.randomString() }
    }

    @MainActor
    private func open(_ address: String, redirectUri: String, ephemeral: Bool) async throws -> Any? {
        guard session == nil else {
            throw PluginError(code: "ERR_UNAVAILABLE", message: "A sign-in is already open")
        }
        guard let url = URL(string: address), let scheme = URL(string: redirectUri)?.scheme else {
            throw PluginError(code: "ERR_INVALID_ARGUMENT", message: "That isn't a URL")
        }

        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Any?, Error>) in
            var hasAnswered = false
            // A session that doesn't start may also call its handler: once is the answer.
            let answer = { [weak self] (result: Result<Any?, Error>) in
                guard !hasAnswered else { return }

                hasAnswered = true
                self?.session = nil
                continuation.resume(with: result)
            }
            let session = makeSession(url: url, scheme: scheme) { callbackURL, error in
                if let callbackURL { return answer(.success(["type": "success", "url": callbackURL.absoluteString])) }
                if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                    return answer(.success(["type": "cancel"]))
                }

                answer(.failure(PluginError(
                    code: "ERR_UNAVAILABLE", message: error?.localizedDescription ?? "The sign-in couldn't open"
                )))
            }

            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = ephemeral
            self.session = session
            if !session.start() {
                answer(.failure(PluginError(code: "ERR_UNAVAILABLE", message: "The sign-in couldn't open")))
            }
        }
    }

    private func makeSession(
        url: URL, scheme: String, completion: @escaping (URL?, Error?) -> Void
    ) -> ASWebAuthenticationSession {
        if #available(iOS 17.4, *) {
            return ASWebAuthenticationSession(url: url, callback: .customScheme(scheme), completionHandler: completion)
        }

        return ASWebAuthenticationSession(url: url, callbackURLScheme: scheme, completionHandler: completion)
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)

        return windows.first { $0.isKeyWindow } ?? windows.first ?? ASPresentationAnchor()
    }

    /// 32 random bytes from the system's secure generator, base64url: 43 characters, as PKCE asks.
    private static func randomString() throws -> String {
        var bytes = Data(count: 32)
        let status = bytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }

        guard status == errSecSuccess else {
            throw PluginError(code: "ERR_UNAVAILABLE", message: "No secure random bytes")
        }

        return base64URL(bytes)
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
