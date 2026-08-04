<?php
/**
 * Plugin Name: FV Sin Photon
 * Description: Desactiva Jetpack Photon (i0.wp.com) y sirve imágenes desde el dominio propio.
 * Version: 1.0.0
 * Author: FV Digital
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_filter( 'jetpack_photon_disable', '__return_true', 99 );
add_filter( 'jetpack_photon_skip_image', '__return_true', 99 );
add_filter( 'jetpack_images_cdn_skip_image', '__return_true', 99 );

add_filter(
	'jetpack_get_available_modules',
	static function ( $modules ) {
		unset( $modules['photon'] );
		return $modules;
	},
	99
);

add_filter(
	'option_jetpack_active_modules',
	static function ( $modules ) {
		if ( ! is_array( $modules ) ) {
			return $modules;
		}
		return array_values( array_diff( $modules, array( 'photon' ) ) );
	},
	99
);

/**
 * Convierte URLs de i0.wp.com / i1.wp.com de vuelta al origen.
 */
function fv_sin_photon_dephotonize( $url ) {
	if ( ! is_string( $url ) || $url === '' ) {
		return $url;
	}

	if ( preg_match( '#^https?://i\d\.wp\.com/(.+)$#i', $url, $matches ) ) {
		$path = preg_replace( '/\?.*$/', '', $matches[1] );
		return 'https://' . ltrim( $path, '/' );
	}

	return $url;
}

add_filter( 'wp_get_attachment_url', 'fv_sin_photon_dephotonize', 99 );
add_filter(
	'wp_get_attachment_image_src',
	static function ( $image ) {
		if ( is_array( $image ) && isset( $image[0] ) ) {
			$image[0] = fv_sin_photon_dephotonize( $image[0] );
		}
		return $image;
	},
	99
);

add_filter(
	'wp_calculate_image_srcset',
	static function ( $sources ) {
		if ( ! is_array( $sources ) ) {
			return $sources;
		}
		foreach ( $sources as $width => $source ) {
			if ( isset( $source['url'] ) ) {
				$sources[ $width ]['url'] = fv_sin_photon_dephotonize( $source['url'] );
			}
		}
		return $sources;
	},
	99
);

add_filter(
	'the_content',
	static function ( $content ) {
		if ( $content === '' ) {
			return $content;
		}
		return preg_replace_callback(
			'#https?://i\d\.wp\.com/([^"\')\s]+)#i',
			static function ( $matches ) {
				return fv_sin_photon_dephotonize( $matches[0] );
			},
			$content
		);
	},
	999
);
