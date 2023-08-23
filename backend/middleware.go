package middleware

import (
	"context"
	"crypto/ed25519"
	"errors"
	"net/http"
	"strings"

	"gitlab.com/gotbitio/blockchain/pepega/custdev/neonomad/neonomad-nft-marketplace/neonomad-api/neonomad-core/internal/handler/response"
	auth "gitlab.com/gotbitio/blockchain/pepega/custdev/neonomad/neonomad-nft-marketplace/neonomad-api/neonomad-core/pkg/claims"
	"gitlab.com/gotbitio/blockchain/pepega/custdev/neonomad/neonomad-nft-marketplace/neonomad-api/neonomad-core/tools/logger"
)

type ctxKey uint8

const (
	ctxKeyAddress ctxKey = iota
	ctxKeyRoles
)

const (
	RoleAdmin      = "admin"
	RoleSuperAdmin = "superadmin"
	RoleUser       = "user"
)

const (
	HeaderFakeUserAddr = "X-Fake-User-Addr"
	HeaderFakeRole     = "X-Fake-Role"

	HeaderAuth = "Authorization"
)

var (
	ErrTokenInvalid    = errors.New("bearer token is not correct")
	ErrNotEnoughRights = errors.New("not enough rights”")
)

var rolesMap = map[string]struct{}{
	RoleAdmin:      {},
	RoleUser:       {},
	RoleSuperAdmin: {},
}

// AuthMW middleware
type AuthMW struct {
	allowFake bool
	publicKey *ed25519.PublicKey
}

func NewAuthMW(allowFake bool, publicKey *ed25519.PublicKey) *AuthMW {
	return &AuthMW{
		allowFake: allowFake,
		publicKey: publicKey,
	}
}

func (a *AuthMW) Auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if a.allowFake {
			ctx, ok := a.FakeAuth(r)
			if ok {
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
		}

		a.contextUpdate(next).ServeHTTP(w, r)
	}
}

func (a *AuthMW) contextUpdate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		var token string
		bearerToken := r.Header.Get(HeaderAuth)
		tokenParts := strings.Split(bearerToken, " ")
		if len(tokenParts) == 2 {
			token = tokenParts[1]
		} else {
			logger.Error("incorrect token")
			response.Unauthenticated(w, ErrTokenInvalid.Error())
			return
		}

		c, err := parseClaims(token, a.publicKey)
		if err != nil {
			logger.Error("error on contextUpdate.parseClaims not ok")
			response.Unauthenticated(w, ErrTokenInvalid.Error())
			return
		}

		ctx = context.WithValue(ctx, ctxKeyRoles, c.Role.Abilities)
		ctx = context.WithValue(ctx, ctxKeyAddress, c.Name)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (a *AuthMW) FakeAuth(r *http.Request) (context.Context, bool) {
	ctx := r.Context()

	fakeAcc := r.Header.Get(HeaderFakeUserAddr)
	fakeRoles := r.Header.Get(HeaderFakeRole)

	if len(fakeAcc) == 0 {
		return ctx, false
	}

	roles := make([]string, 0)
	if fakeRoles != "" {
		roles = strings.Split(fakeRoles, ",")
	}

	ctx = context.WithValue(ctx, ctxKeyAddress, fakeAcc)
	ctx = context.WithValue(ctx, ctxKeyRoles, roles)
	return ctx, true
}

func parseClaims(token string, public *ed25519.PublicKey) (*auth.Claims, error) {
	claims := auth.Claims{}
	err := claims.Parse(token, *public)
	if err != nil {
		return nil, err
	}
	return &claims, nil
}

func GetRoleAndIssuer(ctx context.Context) (string, string, error) {
	roles, ok := ctx.Value(ctxKeyRoles).(auth.Abilities)
	if !ok || roles == nil {
		return "", "", ErrTokenInvalid
	}

	var role string
	for r := range roles {
		if _, hasRole := rolesMap[r]; !hasRole {
			return "", "", ErrNotEnoughRights
		}
		role = r
		break
	}

	issuer, ok := ctx.Value(ctxKeyAddress).(string)
	if !ok || role == "" {
		return "", "", ErrTokenInvalid
	}
	return role, issuer, nil
}

func CheckRoles(role string, compareWith ...string) bool {
	for _, r := range compareWith {
		if r == role {
			return true
		}
	}
	return false
}
